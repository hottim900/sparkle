import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema.js";
import { setupFTS } from "./fts.js";

const DB_PATH = process.env.DATABASE_URL || "./data/todo.db";

const TARGET_VERSION = 9;

function getSchemaVersion(sqlite: Database.Database): number {
  // Check if schema_version table exists
  const tableExists = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    )
    .get();

  if (!tableExists) {
    sqlite.exec(
      "CREATE TABLE schema_version (version INTEGER NOT NULL)"
    );
    sqlite.exec("INSERT INTO schema_version (version) VALUES (0)");
    return 0;
  }

  const row = sqlite
    .prepare("SELECT version FROM schema_version")
    .get() as { version: number } | undefined;

  if (!row) {
    sqlite.exec("INSERT INTO schema_version (version) VALUES (0)");
    return 0;
  }

  return row.version;
}

function setSchemaVersion(sqlite: Database.Database, version: number) {
  sqlite
    .prepare("UPDATE schema_version SET version = ?")
    .run(version);
}

function runMigrations(sqlite: Database.Database) {
  const version = getSchemaVersion(sqlite);

  if (version >= TARGET_VERSION) return;

  // Step 0→1: Rename source → origin
  if (version < 1) {
    try {
      sqlite.exec("ALTER TABLE items RENAME COLUMN source TO origin");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("no such column")) throw e;
    }
    setSchemaVersion(sqlite, 1);
  }

  // Step 1→2: Rename created_at → created
  if (version < 2) {
    try {
      sqlite.exec("ALTER TABLE items RENAME COLUMN created_at TO created");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("no such column")) throw e;
    }
    setSchemaVersion(sqlite, 2);
  }

  // Step 2→3: Rename updated_at → modified
  if (version < 3) {
    try {
      sqlite.exec("ALTER TABLE items RENAME COLUMN updated_at TO modified");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("no such column")) throw e;
    }
    setSchemaVersion(sqlite, 3);
  }

  // Step 3→4: Rename due_date → due
  if (version < 4) {
    try {
      sqlite.exec("ALTER TABLE items RENAME COLUMN due_date TO due");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("no such column")) throw e;
    }
    setSchemaVersion(sqlite, 4);
  }

  // Step 4→5: Add source column (URL reference)
  if (version < 5) {
    try {
      sqlite.exec("ALTER TABLE items ADD COLUMN source TEXT DEFAULT NULL");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }
    setSchemaVersion(sqlite, 5);
  }

  // Step 5→6: Add aliases column
  if (version < 6) {
    try {
      sqlite.exec(
        "ALTER TABLE items ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]'"
      );
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }
    setSchemaVersion(sqlite, 6);
  }

  // Step 6→7: Migrate status values (in transaction)
  if (version < 7) {
    const migrateStatuses = sqlite.transaction(() => {
      sqlite.exec(
        "UPDATE items SET status = 'fleeting' WHERE type = 'note' AND status = 'inbox'"
      );
      sqlite.exec(
        "UPDATE items SET status = 'developing' WHERE type = 'note' AND status = 'active'"
      );
      sqlite.exec(
        "UPDATE items SET status = 'permanent' WHERE type = 'note' AND status = 'done'"
      );
      sqlite.exec(
        "UPDATE items SET status = 'active' WHERE type = 'todo' AND status = 'inbox'"
      );
      // todo active/done/archived unchanged
    });
    migrateStatuses();
    setSchemaVersion(sqlite, 7);
  }

  // Step 7→8: Add linked_note_id column
  if (version < 8) {
    try {
      sqlite.exec(
        "ALTER TABLE items ADD COLUMN linked_note_id TEXT DEFAULT NULL"
      );
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }
    setSchemaVersion(sqlite, 8);
  }

  // Step 8→9: Create settings table with defaults
  if (version < 9) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT OR IGNORE INTO settings (key, value) VALUES
        ('obsidian_enabled', 'false'),
        ('obsidian_vault_path', ''),
        ('obsidian_inbox_folder', '0_Inbox'),
        ('obsidian_export_mode', 'overwrite');
    `);
    setSchemaVersion(sqlite, 9);
  }
}

function createDb() {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  // Check if the items table exists
  const tableExists = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='items'"
    )
    .get();

  if (!tableExists) {
    // Fresh install: create table with new schema directly
    sqlite.exec(`
      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'note',
        title TEXT NOT NULL,
        content TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'fleeting',
        priority TEXT,
        due TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        origin TEXT DEFAULT '',
        source TEXT DEFAULT NULL,
        aliases TEXT NOT NULL DEFAULT '[]',
        linked_note_id TEXT DEFAULT NULL,
        created TEXT NOT NULL,
        modified TEXT NOT NULL
      );

      CREATE INDEX idx_items_status ON items(status);
      CREATE INDEX idx_items_type ON items(type);
      CREATE INDEX idx_items_created ON items(created DESC);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO settings (key, value) VALUES
        ('obsidian_enabled', 'false'),
        ('obsidian_vault_path', ''),
        ('obsidian_inbox_folder', '0_Inbox'),
        ('obsidian_export_mode', 'overwrite');
    `);

    // Set version to target directly for fresh installs
    sqlite.exec(
      "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)"
    );
    sqlite.exec(
      `INSERT INTO schema_version (version) VALUES (${TARGET_VERSION})`
    );
  } else {
    // Existing database: run migrations
    runMigrations(sqlite);

    // Recreate indexes with new column names (idempotent)
    try {
      sqlite.exec("DROP INDEX IF EXISTS idx_items_created_at");
      sqlite.exec(
        "CREATE INDEX IF NOT EXISTS idx_items_created ON items(created DESC)"
      );
    } catch {
      // Index operations are best-effort
    }
  }

  setupFTS(sqlite);

  return { db, sqlite };
}

// Cache on globalThis to avoid multiple connections in dev (tsx watch)
declare global {
  // eslint-disable-next-line no-var
  var __db: ReturnType<typeof createDb> | undefined;
}

function getDb() {
  if (!globalThis.__db) {
    globalThis.__db = createDb();
  }
  return globalThis.__db;
}

export const { db, sqlite } = getDb();
export { DB_PATH };
