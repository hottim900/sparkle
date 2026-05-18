import { describe, it, expect } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "../../test-utils.js";
import { setupFTS } from "../fts.js";

/**
 * Pre-PR0a (ENG-16 prerequisite): items_active_au must fire only on
 * UPDATE OF title, content. The pre-v26 unqualified form fires on every
 * column update, which makes the upcoming reindex_dirty flag flip cycle
 * back through FTS unnecessarily.
 */

function getTriggerSql(sqlite: Database.Database, name: string): string | undefined {
  const row = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?")
    .get(name) as { sql: string } | undefined;
  return row?.sql;
}

describe("fts items_active_au trigger narrowing", () => {
  it("creates items_active_au with AFTER UPDATE OF title, content", () => {
    const { sqlite } = createTestDb();
    const sql = getTriggerSql(sqlite, "items_active_au");
    expect(sql).toBeDefined();
    expect(sql).toContain("AFTER UPDATE OF title, content");
  });

  it("replaces a pre-v26 unqualified trigger on next setupFTS", () => {
    const { sqlite } = createTestDb();
    // Simulate an existing pre-v26 database by dropping the narrow trigger
    // installed by createTestDb and installing the legacy unqualified form.
    sqlite.exec("DROP TRIGGER items_active_au");
    sqlite.exec(`
      CREATE TRIGGER items_active_au AFTER UPDATE ON items_active BEGIN
        INSERT INTO items_active_fts(items_active_fts, rowid, title, content)
        VALUES ('delete', old.rowid, old.title, old.content);
        INSERT INTO items_active_fts(rowid, title, content)
        VALUES (new.rowid, new.title, new.content);
      END;
    `);
    expect(getTriggerSql(sqlite, "items_active_au")).not.toContain("AFTER UPDATE OF");

    setupFTS(sqlite);

    expect(getTriggerSql(sqlite, "items_active_au")).toContain("AFTER UPDATE OF title, content");
  });

  it("ai and ad triggers remain untouched", () => {
    const { sqlite } = createTestDb();
    expect(getTriggerSql(sqlite, "items_active_ai")).toContain("AFTER INSERT");
    expect(getTriggerSql(sqlite, "items_active_ad")).toContain("AFTER DELETE");
  });

  it("UPDATE OF title still reindexes FTS (regression)", () => {
    const { sqlite } = createTestDb();
    sqlite
      .prepare(
        "INSERT INTO items_active (id, title, content, created, modified) VALUES (?, ?, ?, ?, ?)",
      )
      .run("a", "First Title", "body", "2026-01-01", "2026-01-01");

    const matchFirst = sqlite
      .prepare(
        "SELECT items_active.id FROM items_active_fts JOIN items_active ON items_active.rowid = items_active_fts.rowid WHERE items_active_fts MATCH ?",
      )
      .all("First") as { id: string }[];
    expect(matchFirst).toEqual([{ id: "a" }]);

    sqlite.prepare("UPDATE items_active SET title = ? WHERE id = ?").run("Renamed Title", "a");

    const matchOld = sqlite
      .prepare(
        "SELECT items_active.id FROM items_active_fts JOIN items_active ON items_active.rowid = items_active_fts.rowid WHERE items_active_fts MATCH ?",
      )
      .all("First") as { id: string }[];
    expect(matchOld).toEqual([]);
    const matchNew = sqlite
      .prepare(
        "SELECT items_active.id FROM items_active_fts JOIN items_active ON items_active.rowid = items_active_fts.rowid WHERE items_active_fts MATCH ?",
      )
      .all("Renamed") as { id: string }[];
    expect(matchNew).toEqual([{ id: "a" }]);
  });

  it("UPDATE OF content still reindexes FTS (regression)", () => {
    const { sqlite } = createTestDb();
    sqlite
      .prepare(
        "INSERT INTO items_active (id, title, content, created, modified) VALUES (?, ?, ?, ?, ?)",
      )
      .run("a", "T", "hello world", "2026-01-01", "2026-01-01");
    sqlite.prepare("UPDATE items_active SET content = ? WHERE id = ?").run("goodbye moon", "a");
    const matchGoodbye = sqlite
      .prepare(
        "SELECT items_active.id FROM items_active_fts JOIN items_active ON items_active.rowid = items_active_fts.rowid WHERE items_active_fts MATCH ?",
      )
      .all("goodbye") as { id: string }[];
    expect(matchGoodbye.length).toBe(1);
  });

  it("UPDATE of a non-title/content column does NOT churn the FTS shadow", () => {
    const { sqlite } = createTestDb();
    sqlite
      .prepare(
        "INSERT INTO items_active (id, title, content, created, modified) VALUES (?, ?, ?, ?, ?)",
      )
      .run("a", "T", "body", "2026-01-01", "2026-01-01");

    // Each trigger fire writes to the FTS5 shadow segment store
    // (items_active_fts_data). With the narrowed `AFTER UPDATE OF title,
    // content`, UPDATEs to viewed_at / paused / status leave the shadow
    // untouched — load-bearing assertion. Title update is verified
    // functionally (FTS matches the new term) to avoid coupling to FTS5
    // segment-merge heuristics that change across SQLite releases.
    const segmentsBeforeNonText = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM items_active_fts_data").get() as { n: number }
    ).n;

    sqlite.prepare("UPDATE items_active SET viewed_at = ? WHERE id = ?").run("2026-02-01", "a");
    sqlite.prepare("UPDATE items_active SET paused = 1 WHERE id = ?").run("a");
    sqlite.prepare("UPDATE items_active SET status = 'developing' WHERE id = ?").run("a");

    const segmentsAfterNonText = (
      sqlite.prepare("SELECT COUNT(*) AS n FROM items_active_fts_data").get() as { n: number }
    ).n;
    expect(segmentsAfterNonText).toBe(segmentsBeforeNonText);

    sqlite.prepare("UPDATE items_active SET title = ? WHERE id = ?").run("Renamed", "a");
    const matchRenamed = sqlite
      .prepare(
        "SELECT items_active.id FROM items_active_fts JOIN items_active ON items_active.rowid = items_active_fts.rowid WHERE items_active_fts MATCH ?",
      )
      .all("Renamed") as { id: string }[];
    expect(matchRenamed).toEqual([{ id: "a" }]);
  });

  it("setupFTS is idempotent — second call leaves the narrow trigger intact", () => {
    const { sqlite } = createTestDb();
    const firstSql = getTriggerSql(sqlite, "items_active_au");
    setupFTS(sqlite);
    setupFTS(sqlite);
    const finalSql = getTriggerSql(sqlite, "items_active_au");
    expect(finalSql).toBe(firstSql);
    expect(finalSql).toContain("AFTER UPDATE OF title, content");
  });
});
