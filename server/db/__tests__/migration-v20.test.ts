import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";

describe("migration 19→20", () => {
  function createV19Database() {
    const sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    sqlite.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (19);

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
        category_id TEXT DEFAULT NULL,
        viewed_at TEXT DEFAULT NULL,
        is_private INTEGER DEFAULT 0,
        paused INTEGER NOT NULL DEFAULT 0,
        paused_at TEXT DEFAULT NULL,
        paused_context TEXT DEFAULT NULL,
        created TEXT NOT NULL,
        modified TEXT NOT NULL
      );
    `);

    return sqlite;
  }

  function runMigration19to20(sqlite: Database.Database) {
    try {
      sqlite.exec("ALTER TABLE items ADD COLUMN export_path TEXT DEFAULT NULL");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }
    sqlite.prepare("UPDATE schema_version SET version = ?").run(20);
  }

  it("adds export_path column as nullable TEXT", () => {
    const sqlite = createV19Database();
    runMigration19to20(sqlite);

    // Insert an item without export_path — should default to NULL
    sqlite.exec(`
      INSERT INTO items (id, title, created, modified)
      VALUES ('test-1', 'Test', '2026-01-01', '2026-01-01')
    `);

    const row = sqlite.prepare("SELECT export_path FROM items WHERE id = 'test-1'").get() as {
      export_path: string | null;
    };
    expect(row.export_path).toBeNull();
  });

  it("allows writing and reading export_path", () => {
    const sqlite = createV19Database();
    runMigration19to20(sqlite);

    sqlite.exec(`
      INSERT INTO items (id, title, export_path, created, modified)
      VALUES ('test-1', 'Test', '0_Inbox/Test.md', '2026-01-01', '2026-01-01')
    `);

    const row = sqlite.prepare("SELECT export_path FROM items WHERE id = 'test-1'").get() as {
      export_path: string | null;
    };
    expect(row.export_path).toBe("0_Inbox/Test.md");
  });

  it("preserves existing data after migration", () => {
    const sqlite = createV19Database();

    // Insert data before migration
    sqlite.exec(`
      INSERT INTO items (id, title, content, status, created, modified)
      VALUES ('existing-1', 'Existing Note', 'Some content', 'permanent', '2026-01-01', '2026-01-01')
    `);

    runMigration19to20(sqlite);

    const row = sqlite
      .prepare("SELECT title, content, status, export_path FROM items WHERE id = 'existing-1'")
      .get() as {
      title: string;
      content: string;
      status: string;
      export_path: string | null;
    };
    expect(row.title).toBe("Existing Note");
    expect(row.content).toBe("Some content");
    expect(row.status).toBe("permanent");
    expect(row.export_path).toBeNull();
  });

  it("is idempotent (running twice is safe)", () => {
    const sqlite = createV19Database();
    runMigration19to20(sqlite);
    runMigration19to20(sqlite);

    const version = sqlite.prepare("SELECT version FROM schema_version").get() as {
      version: number;
    };
    expect(version.version).toBe(20);

    // Column still works
    sqlite.exec(`
      INSERT INTO items (id, title, export_path, created, modified)
      VALUES ('test-1', 'Test', '0_Inbox/Test.md', '2026-01-01', '2026-01-01')
    `);

    const row = sqlite.prepare("SELECT export_path FROM items WHERE id = 'test-1'").get() as {
      export_path: string | null;
    };
    expect(row.export_path).toBe("0_Inbox/Test.md");
  });
});
