import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";

describe("migration 17→18", () => {
  function createV17Database() {
    const sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    sqlite.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (17);

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
        created TEXT NOT NULL,
        modified TEXT NOT NULL,
        FOREIGN KEY (linked_note_id) REFERENCES items(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_items_status ON items(status);
      CREATE INDEX idx_items_type ON items(type);
      CREATE INDEX idx_items_created ON items(created DESC);
    `);

    return sqlite;
  }

  function runMigration17to18(sqlite: Database.Database) {
    try {
      sqlite.exec("ALTER TABLE items ADD COLUMN paused INTEGER NOT NULL DEFAULT 0");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }
    try {
      sqlite.exec("ALTER TABLE items ADD COLUMN paused_at TEXT DEFAULT NULL");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }
    try {
      sqlite.exec("ALTER TABLE items ADD COLUMN paused_context TEXT DEFAULT NULL");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }
    sqlite.exec("CREATE INDEX IF NOT EXISTS idx_items_paused ON items(paused) WHERE paused = 1");
    sqlite.prepare("UPDATE schema_version SET version = ?").run(18);
  }

  it("should add paused columns with correct defaults", () => {
    const sqlite = createV17Database();

    sqlite.exec(`
      INSERT INTO items (id, title, type, status, created, modified)
      VALUES ('test-1', 'Test Item', 'note', 'developing', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `);

    runMigration17to18(sqlite);

    const item = sqlite
      .prepare("SELECT paused, paused_at, paused_context FROM items WHERE id = 'test-1'")
      .get() as {
      paused: number;
      paused_at: string | null;
      paused_context: string | null;
    };
    expect(item.paused).toBe(0);
    expect(item.paused_at).toBeNull();
    expect(item.paused_context).toBeNull();

    const version = sqlite.prepare("SELECT version FROM schema_version").get() as {
      version: number;
    };
    expect(version.version).toBe(18);
  });

  it("should create partial index on paused column", () => {
    const sqlite = createV17Database();
    runMigration17to18(sqlite);

    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_items_paused'")
      .get();
    expect(indexes).toBeTruthy();
  });

  it("should be idempotent (running twice does not error)", () => {
    const sqlite = createV17Database();

    runMigration17to18(sqlite);
    runMigration17to18(sqlite);

    const cols = sqlite.pragma("table_info(items)") as { name: string }[];
    const pausedCols = cols.filter((c) => c.name.startsWith("paused"));
    expect(pausedCols).toHaveLength(3);
  });

  it("should allow setting paused flag on existing items", () => {
    const sqlite = createV17Database();

    sqlite.exec(`
      INSERT INTO items (id, title, type, status, created, modified)
      VALUES ('test-1', 'Test Item', 'note', 'developing', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `);

    runMigration17to18(sqlite);

    sqlite.exec(`
      UPDATE items SET paused = 1, paused_at = '2026-03-29T00:00:00Z', paused_context = 'waiting for review'
      WHERE id = 'test-1'
    `);

    const item = sqlite
      .prepare("SELECT paused, paused_at, paused_context FROM items WHERE id = 'test-1'")
      .get() as {
      paused: number;
      paused_at: string;
      paused_context: string;
    };
    expect(item.paused).toBe(1);
    expect(item.paused_at).toBe("2026-03-29T00:00:00Z");
    expect(item.paused_context).toBe("waiting for review");
  });
});
