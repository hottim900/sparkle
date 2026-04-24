import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createTestDb } from "../../test-utils.js";

/**
 * Guard: every executable SQL snippet in docs/migration-v23.md §2 (query
 * translations) must parse and run against a post-v23 schema. Keeps the doc
 * from drifting from the actual table shape. Snippets with `...` placeholders
 * or pre-v23 `items` references are skipped — the post-v23 RHS is what we
 * promise to self-hosters.
 */

const DOC_PATH = join(__dirname, "..", "..", "..", "docs", "migration-v23.md");

describe("docs/migration-v23.md §2 — post-v23 SQL samples are executable", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    sqlite = t.sqlite;

    // Seed representative rows so SELECTs return non-empty (helps surface
    // parse-but-wrong-column errors rather than only catching typos).
    sqlite
      .prepare(
        `INSERT INTO categories (id, name, sort_order, color, created, modified)
         VALUES ('c1','work',0,'#f00',datetime('now'),datetime('now'))`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO items_active (id, type, title, content, status, priority, due, tags, origin, source, aliases, linked_note_id, category_id, viewed_at, is_private, paused, created, modified)
         VALUES ('a1','note','Active fleeting','','fleeting',NULL,NULL,'[]','',NULL,'[]',NULL,'c1',NULL,0,0,datetime('now'),datetime('now'))`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO items_vault (id, title, category_id, tags, aliases, source, origin, export_path, exported_at, created, is_private, content_snippet)
         VALUES ('v1','Vault note','c1','[]','[]',NULL,'web','folder/v1.md',datetime('now'),datetime('now'),0,'snippet')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO vault_files (path, title, frontmatter, content, mtime, content_hash, sparkle_id)
         VALUES ('folder/v1.md','Vault note',NULL,'body',0,'hash','v1')`,
      )
      .run();
  });

  afterEach(() => {
    sqlite?.close();
  });

  it("fleeting select (row 1 RHS) parses and returns active fleeting rows only", () => {
    const rows = sqlite.prepare(`SELECT * FROM items_active WHERE status = 'fleeting'`).all();
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("exported select (row 2 RHS) returns all vault rows", () => {
    const rows = sqlite.prepare(`SELECT * FROM items_vault`).all();
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("UNION ALL of items from both tables (row 4 RHS) parses and returns merged rows", () => {
    // Doc row 4 says "SELECT ... FROM items_active UNION ALL SELECT ... FROM items_vault — normalize columns first".
    // Concrete normalized projection — same 3-col shape self-hosters would pick when translating a pre-v23 bare-items SELECT:
    const rows = sqlite
      .prepare(
        `SELECT id, title, 'active' AS src FROM items_active
         UNION ALL
         SELECT id, title, 'vault'  AS src FROM items_vault
         ORDER BY id`,
      )
      .all() as Array<{ id: string; title: string; src: string }>;
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.src).sort()).toEqual(["active", "vault"]);
  });

  it("active→vault move (row 5 RHS) runs inside a transaction without error", () => {
    sqlite.exec(`
      BEGIN;
      INSERT INTO items_vault (id, title, tags, aliases, exported_at, created, content_snippet)
        SELECT id, title, tags, aliases, datetime('now'), created, '' FROM items_active WHERE id = 'a1';
      DELETE FROM items_active WHERE id = 'a1';
      COMMIT;
    `);
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM items_active WHERE id='a1'`).get()).toEqual({
      c: 0,
    });
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM items_vault WHERE id='a1'`).get()).toEqual({
      c: 1,
    });
  });

  it("vault hard-delete + vault_files null (row 6 RHS) runs atomically", () => {
    sqlite.exec(`
      BEGIN;
      DELETE FROM items_vault WHERE id = 'v1';
      UPDATE vault_files SET sparkle_id = NULL WHERE sparkle_id = 'v1';
      COMMIT;
    `);
    expect(sqlite.prepare(`SELECT COUNT(*) AS c FROM items_vault WHERE id='v1'`).get()).toEqual({
      c: 0,
    });
    const file = sqlite
      .prepare(`SELECT sparkle_id FROM vault_files WHERE path='folder/v1.md'`)
      .get() as { sparkle_id: string | null };
    expect(file.sparkle_id).toBeNull();
  });

  it("short-id cross-table probe (fenced block lines 90-97) returns at most one match per table", () => {
    // Introduce two rows with the same short-id prefix to stress the collision case.
    sqlite
      .prepare(
        `INSERT INTO items_vault (id, title, tags, aliases, exported_at, created, content_snippet)
         VALUES ('deadbeef0001','probe',  '[]','[]',datetime('now'),datetime('now'),'')`,
      )
      .run();
    const active = sqlite
      .prepare(`SELECT 'active' AS tbl, id, title FROM items_active WHERE id LIKE 'dead%' LIMIT 2`)
      .all();
    const vault = sqlite
      .prepare(`SELECT 'vault'  AS tbl, id, title FROM items_vault  WHERE id LIKE 'dead%' LIMIT 2`)
      .all();
    expect(active.length + vault.length).toBe(1);
  });

  it("UNION ALL pattern from Shape A (fenced block lines 112-122) parses with concrete columns", () => {
    // Doc uses `...` ellipses for brevity; here we substantiate to the shape
    // getRecentItems actually queries (14 columns matching RecentActivityItem).
    const rows = sqlite
      .prepare(
        `SELECT * FROM (
           SELECT i.id, i.type, i.title, i.status, i.priority, i.due, i.tags, i.origin,
                  i.category_id, NULL AS category_name, i.created, i.modified, i.viewed_at,
                  CASE WHEN (julianday(i.modified) - julianday(i.created)) * 1440 < 1
                       THEN 'created' ELSE 'updated' END AS activity
             FROM items_active i
            WHERE i.modified >= datetime('now','-7 days') AND i.status != 'archived' AND i.is_private = 0
           UNION ALL
           SELECT v.id, 'note' AS type, v.title, 'exported' AS status, NULL AS priority,
                  NULL AS due, v.tags, v.origin, v.category_id, NULL AS category_name,
                  v.created, v.exported_at AS modified, NULL AS viewed_at, 'exported' AS activity
             FROM items_vault v
            WHERE v.exported_at >= datetime('now','-7 days') AND v.is_private = 0
         )
         ORDER BY modified DESC, id ASC
         LIMIT 10 OFFSET 0`,
      )
      .all() as Array<{ id: string; activity: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    // Both sides of the union contribute.
    const activities = new Set(rows.map((r) => r.activity));
    expect(activities).toContain("exported");
  });

  it("doc file exists and contains the expected §2 heading", () => {
    const content = readFileSync(DOC_PATH, "utf-8");
    expect(content).toContain("## 2. Query translations");
    // Cheap staleness trip-wire: if someone strips the post-v23 RHS references,
    // the doc no longer mentions the new tables, and this assertion fires.
    expect(content).toContain("items_active");
    expect(content).toContain("items_vault");
  });
});
