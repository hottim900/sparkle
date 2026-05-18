import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { initializeDatabase } from "../index";

function createV14Database() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (14);

    CREATE TABLE categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0, color TEXT DEFAULT NULL,
      created TEXT NOT NULL, modified TEXT NOT NULL
    );

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
      created TEXT NOT NULL,
      modified TEXT NOT NULL,
      FOREIGN KEY (linked_note_id) REFERENCES items(id) ON DELETE SET NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_items_status ON items(status);
    CREATE INDEX idx_items_type ON items(type);
    CREATE INDEX idx_items_created ON items(created DESC);
    CREATE INDEX idx_items_viewed_at ON items(viewed_at);
    CREATE INDEX idx_items_status_modified ON items(status, modified);

    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE share_tokens (
      id TEXT PRIMARY KEY, item_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE, visibility TEXT NOT NULL DEFAULT 'unlisted',
      created TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );
  `);
  return sqlite;
}

// v1.4.0 (migration v23): `items` table was split into `items_active` + `items_vault`.
// Fresh installs jump straight to v23, so schema inspection targets `items_active`.
// The v14 upgrade path still runs migrations 15→22→23, but at the end the legacy
// `items` table is gone — the row is in `items_active`.
describe("Migration v15: is_private column (post-v23 split-aware)", () => {
  it("fresh install creates items_active with is_private column", () => {
    const sqlite = new Database(":memory:");
    initializeDatabase(sqlite);
    const cols = sqlite.pragma("table_info(items_active)") as {
      name: string;
      dflt_value: string;
    }[];
    const col = cols.find((c) => c.name === "is_private");
    expect(col).toBeDefined();
    expect(col!.dflt_value).toBe("0");
  });

  it("fresh install includes items_active composite indexes", () => {
    const sqlite = new Database(":memory:");
    initializeDatabase(sqlite);
    const indexes = sqlite.pragma("index_list(items_active)") as { name: string }[];
    const names = indexes.map((i) => i.name);
    // v23 replaces `idx_items_private_status{,_modified}` with more targeted indexes.
    expect(names).toContain("idx_items_active_type_status");
    expect(names).toContain("idx_items_active_modified");
  });

  it("fresh install preserves type/status-index safety net", () => {
    const sqlite = new Database(":memory:");
    initializeDatabase(sqlite);
    const indexes = sqlite.pragma("index_list(items_active)") as { name: string }[];
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_items_active_type_status");
  });

  it("is idempotent (running twice does not error)", () => {
    const sqlite = new Database(":memory:");
    initializeDatabase(sqlite);
    expect(() => initializeDatabase(sqlite)).not.toThrow();
  });

  it("upgrade from v14: row ends up in items_active with is_private populated", () => {
    const sqlite = createV14Database();
    sqlite.exec(
      `INSERT INTO items (id, title, created, modified) VALUES ('item-1', 'Test', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );
    initializeDatabase(sqlite);

    const row = sqlite.prepare("SELECT is_private FROM items_active WHERE id = 'item-1'").get() as
      | { is_private: number }
      | undefined;
    expect(row).toBeDefined();
    expect(row!.is_private).toBe(0);

    const ver = sqlite.prepare("SELECT version FROM schema_version").get() as {
      version: number;
    };
    expect(ver.version).toBe(26);
  });

  it("upgrade from v14: is idempotent", () => {
    const sqlite = createV14Database();
    initializeDatabase(sqlite);
    expect(() => initializeDatabase(sqlite)).not.toThrow();
  });
});
