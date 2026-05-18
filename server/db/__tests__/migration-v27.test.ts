import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backfillLegacyHexInContent, migrateV26toV27 } from "../index.js";

function createV26Db(path: string): Database.Database {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
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
      reindex_dirty INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL,
      modified TEXT NOT NULL,
      CHECK (
        (type = 'note' AND status IN ('fleeting','developing','permanent','archived')) OR
        (type = 'todo' AND status IN ('active','done','archived')) OR
        (type = 'scratch' AND status IN ('draft','archived'))
      )
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
    INSERT INTO schema_version (version) VALUES (26);
  `);
  return sqlite;
}

describe("backfillLegacyHexInContent (unit)", () => {
  const okLookup = (title: string) => () => ({ title, ambiguous: false });

  it("returns content unchanged when no legacy pattern", () => {
    const r = backfillLegacyHexInContent("plain text [[wikilink]]", okLookup("X"));
    expect(r.rewrites).toBe(0);
    expect(r.newContent).toBe("plain text [[wikilink]]");
  });

  it("rewrites a single 筆記（xxxx） to [[Title]]", () => {
    const r = backfillLegacyHexInContent("see 筆記（abcd1234） here", okLookup("My Note"));
    expect(r.rewrites).toBe(1);
    expect(r.newContent).toBe("see [[My Note]] here");
  });

  it("rewrites multiple matches in descending offset order without corruption", () => {
    const r = backfillLegacyHexInContent("筆記（aaaa） and 筆記（bbbb）", okLookup("X"));
    expect(r.rewrites).toBe(2);
    expect(r.newContent).toBe("[[X]] and [[X]]");
  });

  it("skips matches inside fenced code blocks", () => {
    const before = "before\n```\n筆記（abcd）\n```\n筆記（abcd） outside";
    const r = backfillLegacyHexInContent(before, okLookup("T"));
    expect(r.rewrites).toBe(1);
    expect(r.newContent).toBe("before\n```\n筆記（abcd）\n```\n[[T]] outside");
  });

  it("skips matches inside inline backticks", () => {
    const r = backfillLegacyHexInContent("`筆記（abcd）` and 筆記（abcd）", okLookup("T"));
    expect(r.rewrites).toBe(1);
    expect(r.newContent).toBe("`筆記（abcd）` and [[T]]");
  });

  it("ambiguous matches are left verbatim and reported", () => {
    const lookup = () => ({ title: "", ambiguous: true });
    const r = backfillLegacyHexInContent("see 筆記（abcd1234） please", lookup);
    expect(r.rewrites).toBe(0);
    expect(r.ambiguous).toEqual(["abcd1234"]);
    expect(r.newContent).toBe("see 筆記（abcd1234） please");
  });

  it("sanitizes alias chars in titles (| ]] [[ \\n)", () => {
    const r = backfillLegacyHexInContent("筆記（abcd）", okLookup("Bad|Title]]With[[Stuff\nand"));
    expect(r.newContent).toBe("[[Bad-Title）With（Stuff and]]");
  });

  it("null lookup (target deleted) leaves reference verbatim", () => {
    const r = backfillLegacyHexInContent("see 筆記（abcd） here", () => null);
    expect(r.rewrites).toBe(0);
    expect(r.newContent).toBe("see 筆記（abcd） here");
  });
});

describe("migrateV26toV27", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "v27-test-"));
    dbPath = join(tmpDir, "test.db");
    process.env.SPARKLE_MIGRATION_BACKUP_DIR = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.SPARKLE_MIGRATION_BACKUP_DIR;
  });

  it("noop when no legacy patterns exist (no backup written)", () => {
    const sqlite = createV26Db(dbPath);
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO items_active (id, type, status, title, content, created, modified)
         VALUES ('a', 'note', 'fleeting', 'X', 'plain content', ?, ?)`,
      )
      .run(now, now);

    migrateV26toV27(sqlite);

    const v = sqlite.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(v.version).toBe(27);
    // backfill_v27_ambiguous still created so subsequent migrations see it
    const table = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='backfill_v27_ambiguous'",
      )
      .get();
    expect(table).toBeTruthy();
    sqlite.close();
  });

  it("rewrites legacy refs to [[Title]] and bumps version", () => {
    const sqlite = createV26Db(dbPath);
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO items_active (id, type, status, title, content, created, modified)
         VALUES ('abcd1234-0000-4000-8000-000000000000', 'note', 'fleeting', 'Target', '', ?, ?)`,
      )
      .run(now, now);
    sqlite
      .prepare(
        `INSERT INTO items_active (id, type, status, title, content, created, modified)
         VALUES ('source-id', 'note', 'fleeting', 'Source', 'see 筆記（abcd1234） here', ?, ?)`,
      )
      .run(now, now);

    migrateV26toV27(sqlite);

    const v = sqlite.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(v.version).toBe(27);
    const src = sqlite
      .prepare("SELECT content, reindex_dirty FROM items_active WHERE id = 'source-id'")
      .get() as { content: string; reindex_dirty: number };
    expect(src.content).toBe("see [[Target]] here");
    expect(src.reindex_dirty).toBe(1);
    sqlite.close();
  });

  it("records ambiguous matches without rewriting", () => {
    const sqlite = createV26Db(dbPath);
    const now = new Date().toISOString();
    // Two items_active rows sharing 4-char prefix to trigger ambiguity
    sqlite
      .prepare(
        `INSERT INTO items_active (id, type, status, title, content, created, modified)
         VALUES ('abcd0001-0000-4000-8000-000000000000', 'note', 'fleeting', 'A1', '', ?, ?)`,
      )
      .run(now, now);
    sqlite
      .prepare(
        `INSERT INTO items_active (id, type, status, title, content, created, modified)
         VALUES ('abcd0002-0000-4000-8000-000000000000', 'note', 'fleeting', 'A2', '', ?, ?)`,
      )
      .run(now, now);
    sqlite
      .prepare(
        `INSERT INTO items_active (id, type, status, title, content, created, modified)
         VALUES ('src', 'note', 'fleeting', 'Src', '筆記（abcd）', ?, ?)`,
      )
      .run(now, now);

    migrateV26toV27(sqlite);

    const src = sqlite.prepare("SELECT content FROM items_active WHERE id = 'src'").get() as {
      content: string;
    };
    expect(src.content).toBe("筆記（abcd）"); // unchanged

    const amb = sqlite.prepare("SELECT * FROM backfill_v27_ambiguous").all() as {
      short_id: string;
      source_id: string;
    }[];
    expect(amb).toHaveLength(1);
    expect(amb[0]).toMatchObject({ short_id: "abcd", source_id: "src" });
    sqlite.close();
  });

  it("creates a pre-migration backup at the configured dir", () => {
    const sqlite = createV26Db(dbPath);
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO items_active (id, type, status, title, content, created, modified)
         VALUES ('abcd1234-0000-4000-8000-000000000000', 'note', 'fleeting', 'T', '', ?, ?)`,
      )
      .run(now, now);
    sqlite
      .prepare(
        `INSERT INTO items_active (id, type, status, title, content, created, modified)
         VALUES ('src', 'note', 'fleeting', 'S', '筆記（abcd1234）', ?, ?)`,
      )
      .run(now, now);

    migrateV26toV27(sqlite);

    const files = require("node:fs").readdirSync(tmpDir);
    const backups = files.filter((f: string) => f.startsWith("todo.db.bak-pre-v27-"));
    expect(backups.length).toBe(1);
    sqlite.close();
  });
});

// vitest helper import (afterEach is part of the same module)
import { afterEach } from "vitest";
