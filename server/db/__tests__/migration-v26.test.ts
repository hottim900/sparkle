import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { initializeDatabase, migrateV25toV26 } from "../index.js";

function createV25Db(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  // Replay just enough of the v25 schema for the test. Mirrors the
  // fresh-install path minus the v26 additions.
  sqlite.exec(`
    CREATE TABLE categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0, color TEXT,
      created TEXT NOT NULL, modified TEXT NOT NULL
    );
    CREATE TABLE items_active (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      is_private INTEGER NOT NULL DEFAULT 0,
      category_id TEXT,
      priority TEXT,
      due TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      aliases TEXT NOT NULL DEFAULT '[]',
      source TEXT,
      origin TEXT,
      linked_note_id TEXT,
      viewed_at TEXT,
      paused INTEGER NOT NULL DEFAULT 0,
      paused_at TEXT,
      paused_context TEXT,
      created TEXT NOT NULL,
      modified TEXT NOT NULL,
      CHECK (
        (type = 'note' AND status IN ('fleeting','developing','permanent','archived')) OR
        (type = 'todo' AND status IN ('active','done','archived')) OR
        (type = 'scratch' AND status IN ('draft','archived'))
      ),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );
    CREATE TABLE items_vault (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      aliases TEXT NOT NULL DEFAULT '[]',
      exported_at TEXT NOT NULL,
      created TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0,
      content_snippet TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (25);
  `);
  return sqlite;
}

describe("Migration v25→v26", () => {
  it("adds items_active.reindex_dirty column", () => {
    const sqlite = createV25Db();
    migrateV25toV26(sqlite);
    const cols = sqlite.prepare("PRAGMA table_info(items_active)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "reindex_dirty")).toBe(true);
  });

  it("creates reference_index table with expected shape", () => {
    const sqlite = createV25Db();
    migrateV25toV26(sqlite);
    const cols = sqlite.prepare("PRAGMA table_info(reference_index)").all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(["id", "source_id", "target_id", "char_offset", "raw_title", "kind"]),
    );
  });

  it("creates rename_history table", () => {
    const sqlite = createV25Db();
    migrateV25toV26(sqlite);
    const cols = sqlite.prepare("PRAGMA table_info(rename_history)").all() as { name: string }[];
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(["id", "target_id", "old_title", "new_title", "performed_at"]),
    );
  });

  it("marks every existing items_active row reindex_dirty=1", () => {
    const sqlite = createV25Db();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO items_active (id, type, status, title, created, modified)
         VALUES (?, 'note', 'fleeting', ?, ?, ?)`,
      )
      .run("id-1", "Existing", now, now);

    migrateV25toV26(sqlite);

    const row = sqlite
      .prepare("SELECT reindex_dirty FROM items_active WHERE id = 'id-1'")
      .get() as { reindex_dirty: number };
    expect(row.reindex_dirty).toBe(1);
  });

  it("creates the partial index on reindex_dirty", () => {
    const sqlite = createV25Db();
    migrateV25toV26(sqlite);
    const idxs = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='items_active'")
      .all() as { name: string }[];
    expect(idxs.some((i) => i.name === "idx_items_active_reindex_dirty")).toBe(true);
  });

  it("bumps schema_version to 26", () => {
    const sqlite = createV25Db();
    migrateV25toV26(sqlite);
    const v = sqlite.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(v.version).toBe(26);
  });

  it("is idempotent on re-run", () => {
    const sqlite = createV25Db();
    migrateV25toV26(sqlite);
    // Manually decrement and re-run; this simulates an operator force-rerun.
    sqlite.prepare("UPDATE schema_version SET version = 25").run();
    expect(() => migrateV25toV26(sqlite)).not.toThrow();
    const v = sqlite.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(v.version).toBe(26);
  });

  it("fresh install starts at version 26 with all tables", () => {
    const sqlite = new Database(":memory:");
    initializeDatabase(sqlite);
    const v = sqlite.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(v.version).toBe(26);

    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["reference_index", "rename_history"]));

    const cols = sqlite.prepare("PRAGMA table_info(items_active)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "reindex_dirty")).toBe(true);
  });
});
