import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { migrateV22toV23 } from "../index";
import { setupFTS } from "../fts";

/**
 * Build a v22-shaped SQLite DB in memory: legacy `items` table + supporting
 * tables + schema_version = 22. This matches what a real production DB looks
 * like immediately before migrateV22toV23 runs.
 */
function seedV22(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (22);

    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );
    CREATE INDEX idx_categories_sort_order ON categories(sort_order);

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
      export_path TEXT DEFAULT NULL,
      created TEXT NOT NULL,
      modified TEXT NOT NULL,
      FOREIGN KEY (linked_note_id) REFERENCES items(id) ON DELETE SET NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE share_tokens (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      visibility TEXT NOT NULL DEFAULT 'unlisted',
      created TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE vault_files (
      path TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      frontmatter TEXT,
      content TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      sparkle_id TEXT DEFAULT NULL
    );
  `);
}

function countRows(sqlite: Database.Database, table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe("Migration v22→v23: items → items_active + items_vault", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    seedV22(sqlite);
  });

  describe("Stage A (full migration)", () => {
    it("splits active and exported items into the two target tables", () => {
      sqlite.exec(`
        INSERT INTO items (id, title, status, created, modified) VALUES
          ('a1', 'Active note', 'fleeting', '2026-01-01', '2026-01-01'),
          ('a2', 'Developing', 'developing', '2026-01-02', '2026-01-02'),
          ('e1', 'Exported', 'exported', '2026-01-03', '2026-01-03');
      `);
      migrateV22toV23(sqlite);
      expect(countRows(sqlite, "items_active")).toBe(2);
      expect(countRows(sqlite, "items_vault")).toBe(1);
      expect(
        sqlite.prepare(`SELECT name FROM sqlite_master WHERE name='items'`).get(),
      ).toBeUndefined();
      expect(
        (sqlite.prepare("SELECT version FROM schema_version").get() as { version: number }).version,
      ).toBe(23);
    });

    it("preserves row count: items_active.count + items_vault.count = items.count pre-migration", () => {
      const rows = [
        ["a1", "fleeting"],
        ["a2", "developing"],
        ["a3", "permanent"],
        ["a4", "archived"],
        ["e1", "exported"],
        ["e2", "exported"],
      ];
      for (const [id, status] of rows) {
        sqlite
          .prepare(
            `INSERT INTO items (id, title, status, created, modified) VALUES (?, ?, ?, ?, ?)`,
          )
          .run(id, id, status, "2026-01-01", "2026-01-01");
      }
      migrateV22toV23(sqlite);
      expect(countRows(sqlite, "items_active") + countRows(sqlite, "items_vault")).toBe(
        rows.length,
      );
    });

    it("preserves viewed_at on items_active rows (R4-BLOCKER-1 regression guard)", () => {
      sqlite.exec(
        `INSERT INTO items (id, title, status, viewed_at, created, modified)
           VALUES ('i1', 'Viewed', 'fleeting', '2026-01-05T10:00:00Z', '2026-01-01', '2026-01-01')`,
      );
      migrateV22toV23(sqlite);
      const row = sqlite.prepare(`SELECT viewed_at FROM items_active WHERE id='i1'`).get() as {
        viewed_at: string;
      };
      expect(row.viewed_at).toBe("2026-01-05T10:00:00Z");
    });

    it("derives items_vault.content_snippet from first 500 chars of content", () => {
      const content = "x".repeat(800);
      sqlite
        .prepare(
          `INSERT INTO items (id, title, status, content, created, modified)
             VALUES ('e1', 'E', 'exported', ?, '2026-01-01', '2026-01-01')`,
        )
        .run(content);
      migrateV22toV23(sqlite);
      const row = sqlite.prepare(`SELECT content_snippet FROM items_vault WHERE id='e1'`).get() as {
        content_snippet: string;
      };
      expect(row.content_snippet.length).toBe(500);
      expect(row.content_snippet).toBe(content.substring(0, 500));
    });

    it("content_snippet defaults to empty string when original content was NULL", () => {
      sqlite.exec(
        `INSERT INTO items (id, title, status, content, created, modified)
           VALUES ('e1', 'E', 'exported', NULL, '2026-01-01', '2026-01-01')`,
      );
      migrateV22toV23(sqlite);
      const row = sqlite.prepare(`SELECT content_snippet FROM items_vault WHERE id='e1'`).get() as {
        content_snippet: string;
      };
      expect(row.content_snippet).toBe("");
    });

    it("nulls cross-table linked_note_id refs before the split (D12)", () => {
      // active todo referencing an exported note — the link would violate
      // items_active's FK (active→active only) post-migration, so A-0 nulls it.
      sqlite.exec(`
        INSERT INTO items (id, title, status, created, modified) VALUES
          ('n1', 'Exported note', 'exported', '2026-01-01', '2026-01-01');
        INSERT INTO items (id, type, title, status, linked_note_id, created, modified) VALUES
          ('t1', 'todo', 'Todo linked to exported', 'active', 'n1', '2026-01-02', '2026-01-02');
      `);
      migrateV22toV23(sqlite);
      const todo = sqlite
        .prepare(`SELECT linked_note_id FROM items_active WHERE id='t1'`)
        .get() as { linked_note_id: string | null };
      expect(todo.linked_note_id).toBeNull();
    });

    it("drops share_tokens pointing at exported items (share_tokens FK rebuild)", () => {
      sqlite.exec(`
        INSERT INTO items (id, title, status, created, modified) VALUES
          ('a1', 'Active', 'fleeting', '2026-01-01', '2026-01-01'),
          ('a2', 'Permanent', 'permanent', '2026-01-02', '2026-01-02'),
          ('e1', 'Exported', 'exported', '2026-01-03', '2026-01-03');
        INSERT INTO share_tokens (id, item_id, token, created) VALUES
          ('s1', 'a1', 'tok1', '2026-01-01'),
          ('s2', 'a2', 'tok2', '2026-01-02'),
          ('s3', 'e1', 'tok3', '2026-01-03');
      `);
      migrateV22toV23(sqlite);
      const survivors = sqlite
        .prepare(`SELECT item_id FROM share_tokens ORDER BY item_id`)
        .all() as { item_id: string }[];
      expect(survivors.map((r) => r.item_id)).toEqual(["a1", "a2"]);
      const orphans = sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM share_tokens WHERE item_id IN (SELECT id FROM items_vault)`,
        )
        .get() as { n: number };
      expect(orphans.n).toBe(0);
    });

    it("preserves category_id FK ON DELETE SET NULL on both tables (R4-BLOCKER-2 regression guard)", () => {
      sqlite.exec(`
        INSERT INTO categories (id, name, created, modified)
          VALUES ('c1', 'Cat', '2026-01-01', '2026-01-01');
        INSERT INTO items (id, title, status, category_id, created, modified) VALUES
          ('a1', 'Active', 'fleeting', 'c1', '2026-01-01', '2026-01-01'),
          ('e1', 'Exported', 'exported', 'c1', '2026-01-02', '2026-01-02');
      `);
      migrateV22toV23(sqlite);
      sqlite.pragma("foreign_keys = ON");
      sqlite.exec(`DELETE FROM categories WHERE id='c1'`);
      const active = sqlite.prepare(`SELECT category_id FROM items_active WHERE id='a1'`).get() as {
        category_id: string | null;
      };
      const vault = sqlite.prepare(`SELECT category_id FROM items_vault WHERE id='e1'`).get() as {
        category_id: string | null;
      };
      expect(active.category_id).toBeNull();
      expect(vault.category_id).toBeNull();
    });

    it("items_active CHECK constraint rejects 'exported' status post-migration", () => {
      migrateV22toV23(sqlite);
      expect(() =>
        sqlite.exec(
          `INSERT INTO items_active (id, type, status, title, created, modified)
             VALUES ('x', 'note', 'exported', 'nope', '2026-01-01', '2026-01-01')`,
        ),
      ).toThrow(/CHECK constraint failed/);
    });

    it("pre-scan rejects rows that would violate items_active CHECK", () => {
      // Legacy corrupt status ('inbox' was renamed to 'fleeting' at v7 — if any
      // survived, the migration should surface them rather than crash inside tx).
      sqlite.exec(
        `INSERT INTO items (id, title, status, created, modified)
           VALUES ('bad', 'Corrupt', 'inbox', '2026-01-01', '2026-01-01')`,
      );
      expect(() => migrateV22toV23(sqlite)).toThrow(/CHECK constraint/);
    });
  });

  describe("Idempotency", () => {
    it("State C: running migration on a post-v23 DB is a no-op and leaves version at 23", () => {
      sqlite.exec(
        `INSERT INTO items (id, title, status, created, modified)
           VALUES ('a1', 'A', 'fleeting', '2026-01-01', '2026-01-01')`,
      );
      migrateV22toV23(sqlite);
      setupFTS(sqlite);
      const activeBefore = countRows(sqlite, "items_active");
      // second invocation should be safe
      migrateV22toV23(sqlite);
      expect(countRows(sqlite, "items_active")).toBe(activeBefore);
      expect(
        (sqlite.prepare("SELECT version FROM schema_version").get() as { version: number }).version,
      ).toBe(23);
    });

    it("State B: partial-completion (items_active exists, FTS empty) rebuilds FTS", () => {
      sqlite.exec(
        `INSERT INTO items (id, title, status, content, created, modified)
           VALUES ('a1', 'A', 'fleeting', 'hello world', '2026-01-01', '2026-01-01')`,
      );
      migrateV22toV23(sqlite);
      // External-content FTS5 virtual tables reflect the content table for
      // COUNT(*), so observable state is MATCH: before rebuild, MATCH returns
      // nothing; after rebuild, it returns the row.
      const matchCount = () =>
        (
          sqlite
            .prepare(`SELECT COUNT(*) AS n FROM items_active_fts WHERE items_active_fts MATCH ?`)
            .get("hello") as { n: number }
        ).n;
      // Simulate a crash that left the FTS shadow index empty: drop + recreate
      // the virtual table without running the 'rebuild' command.
      sqlite.exec(`
        DROP TRIGGER IF EXISTS items_active_ai;
        DROP TRIGGER IF EXISTS items_active_ad;
        DROP TRIGGER IF EXISTS items_active_au;
        DROP TABLE items_active_fts;
        CREATE VIRTUAL TABLE items_active_fts USING fts5(
          title, content,
          content = items_active,
          content_rowid = rowid,
          tokenize = 'trigram'
        );
      `);
      expect(matchCount()).toBe(0);
      sqlite.exec(`UPDATE schema_version SET version = 22`);
      migrateV22toV23(sqlite);
      expect(matchCount()).toBe(1);
    });

    it("throws on inconsistent state (neither items nor items_active)", () => {
      // Drop items without creating items_active — simulates interrupted partial
      // migration or direct operator error.
      sqlite.exec(`DROP TABLE items`);
      sqlite.exec(`UPDATE schema_version SET version = 22`);
      expect(() => migrateV22toV23(sqlite)).toThrow(/inconsistent state/);
    });
  });

  describe("FK pragma safety", () => {
    it("restores foreign_keys = ON even if Stage A throws", () => {
      sqlite.exec(
        `INSERT INTO items (id, title, status, created, modified)
           VALUES ('bad', 'Bad', 'inbox', '2026-01-01', '2026-01-01')`,
      );
      const before = sqlite.pragma("foreign_keys", { simple: true });
      expect(() => migrateV22toV23(sqlite)).toThrow();
      const after = sqlite.pragma("foreign_keys", { simple: true });
      expect(after).toBe(before);
    });
  });
});
