import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";

describe("migration 12→13", () => {
  function createV12Database() {
    const sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    sqlite.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (12);

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
        modified TEXT NOT NULL,
        FOREIGN KEY (linked_note_id) REFERENCES items(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_items_status ON items(status);
      CREATE INDEX idx_items_type ON items(type);
      CREATE INDEX idx_items_created ON items(created DESC);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE share_tokens (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        visibility TEXT NOT NULL DEFAULT 'unlisted',
        created TEXT NOT NULL,
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
      );
    `);

    return sqlite;
  }

  function runMigration12to13(sqlite: Database.Database) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        color TEXT DEFAULT NULL,
        created TEXT NOT NULL,
        modified TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order);
    `);

    try {
      sqlite.exec(
        "ALTER TABLE items ADD COLUMN category_id TEXT DEFAULT NULL REFERENCES categories(id) ON DELETE SET NULL",
      );
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }

    sqlite.exec("CREATE INDEX IF NOT EXISTS idx_items_category_id ON items(category_id)");

    sqlite.prepare("UPDATE schema_version SET version = ?").run(13);
  }

  it("should create categories table and add category_id to items", () => {
    const sqlite = createV12Database();

    // Insert a test item before migration
    sqlite.exec(`
      INSERT INTO items (id, title, created, modified)
      VALUES ('test-1', 'Test Item', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `);

    runMigration12to13(sqlite);

    // Verify categories table exists
    const catTable = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='categories'")
      .get();
    expect(catTable).toBeTruthy();

    // Verify category_id column exists on items with NULL default
    const item = sqlite.prepare("SELECT category_id FROM items WHERE id = 'test-1'").get() as {
      category_id: string | null;
    };
    expect(item.category_id).toBeNull();

    // Verify schema version updated
    const version = sqlite.prepare("SELECT version FROM schema_version").get() as {
      version: number;
    };
    expect(version.version).toBe(13);
  });

  it("should support FK behavior (ON DELETE SET NULL)", () => {
    const sqlite = createV12Database();

    sqlite.exec(`
      INSERT INTO items (id, title, created, modified)
      VALUES ('test-1', 'Test Item', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `);

    runMigration12to13(sqlite);

    // Insert category and link item to it
    sqlite.exec(`
      INSERT INTO categories (id, name, sort_order, created, modified)
      VALUES ('cat-1', 'Test Category', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `);
    sqlite.exec("UPDATE items SET category_id = 'cat-1' WHERE id = 'test-1'");

    const updated = sqlite.prepare("SELECT category_id FROM items WHERE id = 'test-1'").get() as {
      category_id: string;
    };
    expect(updated.category_id).toBe("cat-1");

    // Deleting category should SET NULL on item
    sqlite.exec("DELETE FROM categories WHERE id = 'cat-1'");
    const afterDelete = sqlite
      .prepare("SELECT category_id FROM items WHERE id = 'test-1'")
      .get() as { category_id: string | null };
    expect(afterDelete.category_id).toBeNull();
  });

  it("should be idempotent (running twice does not error)", () => {
    const sqlite = createV12Database();

    // Run migration twice
    runMigration12to13(sqlite);
    runMigration12to13(sqlite);

    // Should not throw — verify table exists
    const catTable = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='categories'")
      .get();
    expect(catTable).toBeTruthy();

    // Verify category_id column exists
    const cols = sqlite.pragma("table_info(items)") as { name: string }[];
    const hasCategoryId = cols.some((c) => c.name === "category_id");
    expect(hasCategoryId).toBe(true);
  });
});
