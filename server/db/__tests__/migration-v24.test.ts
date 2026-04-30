import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateV23toV24, V24HaltError, haltAndExit } from "../index";
import { logger } from "../../lib/logger";

/**
 * Build a v23-shaped DB with the rows + settings v24 expects: items_active,
 * items_vault, vault_files, settings (obsidian_enabled + obsidian_vault_path).
 */
function seedV23(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (23);

    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0, color TEXT, created TEXT NOT NULL, modified TEXT NOT NULL);
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
      viewed_at TEXT DEFAULT NULL,
      paused INTEGER NOT NULL DEFAULT 0,
      paused_at TEXT,
      paused_context TEXT,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );
    CREATE TABLE items_vault (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category_id TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      aliases TEXT NOT NULL DEFAULT '[]',
      source TEXT,
      origin TEXT,
      export_path TEXT,
      exported_at TEXT NOT NULL,
      created TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0,
      content_snippet TEXT NOT NULL DEFAULT ''
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
    CREATE UNIQUE INDEX idx_vault_files_sparkle_id ON vault_files(sparkle_id) WHERE sparkle_id IS NOT NULL;
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO settings (key, value) VALUES ('obsidian_enabled', 'true');
  `);
}

function getSchemaVersion(sqlite: Database.Database): number {
  return (sqlite.prepare("SELECT version FROM schema_version").get() as { version: number })
    .version;
}

describe("Migration v23→v24: vault_files.sparkle_id backfill + orphan check", () => {
  let sqlite: Database.Database;
  let vaultRoot: string;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    vaultRoot = mkdtempSync(join(tmpdir(), "sparkle-v24-"));
    seedV23(sqlite);
    sqlite
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('obsidian_vault_path', ?)")
      .run(vaultRoot);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(vaultRoot, { recursive: true, force: true });
  });

  it("backfills sparkle_id from frontmatter when vault_files row has NULL", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    mkdirSync(join(vaultRoot, "0_Inbox"), { recursive: true });
    const md = `---\nsparkle_id: "${id}"\ntags: []\n---\n\n# Title\n`;
    writeFileSync(join(vaultRoot, "0_Inbox/Test.md"), md);

    sqlite
      .prepare(
        "INSERT INTO vault_files (path, title, frontmatter, content, mtime, content_hash, sparkle_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("0_Inbox/Test.md", "Title", `sparkle_id: "${id}"`, md, 1, "h1", null);
    sqlite
      .prepare(
        "INSERT INTO items_vault (id, title, exported_at, created, content_snippet) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, "Title", "2026-04-30T00:00:00Z", "2026-04-30T00:00:00Z", "");

    migrateV23toV24(sqlite);

    expect(getSchemaVersion(sqlite)).toBe(24);
    const row = sqlite
      .prepare("SELECT sparkle_id FROM vault_files WHERE path = ?")
      .get("0_Inbox/Test.md") as { sparkle_id: string | null } | undefined;
    expect(row?.sparkle_id).toBe(id);
  });

  it("skips empty / no-frontmatter .md without error (legitimate non-Sparkle case)", () => {
    mkdirSync(join(vaultRoot, "Notes"), { recursive: true });
    writeFileSync(join(vaultRoot, "Notes/Plain.md"), "# just a note, no frontmatter\n");

    sqlite
      .prepare(
        "INSERT INTO vault_files (path, title, frontmatter, content, mtime, content_hash, sparkle_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("Notes/Plain.md", "Plain", null, "# just a note", 1, "h2", null);

    expect(() => migrateV23toV24(sqlite)).not.toThrow();
    expect(getSchemaVersion(sqlite)).toBe(24);
  });

  it("halts with V24HaltError(orphans) when items_vault has no vault_files match", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    sqlite
      .prepare(
        "INSERT INTO items_vault (id, title, exported_at, created, content_snippet) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, "Orphan", "2026-04-30T00:00:00Z", "2026-04-30T00:00:00Z", "");
    // No vault_files row pointing at id.

    let caught: V24HaltError | null = null;
    try {
      migrateV23toV24(sqlite);
    } catch (e) {
      if (e instanceof V24HaltError) caught = e;
      else throw e;
    }
    expect(caught).toBeTruthy();
    expect(caught?.haltPayload.event).toBe("migration_v24_halted_orphans");
    expect(caught?.haltPayload.count).toBe(1);
    // Roll-back leaves schema_version at 23 (transaction reverted).
    expect(getSchemaVersion(sqlite)).toBe(23);
  });

  it("re-runs idempotent after operator resolves orphans", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    sqlite
      .prepare(
        "INSERT INTO items_vault (id, title, exported_at, created, content_snippet) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, "Orphan", "2026-04-30T00:00:00Z", "2026-04-30T00:00:00Z", "");

    expect(() => migrateV23toV24(sqlite)).toThrow(V24HaltError);
    expect(getSchemaVersion(sqlite)).toBe(23);

    // Operator deletes the orphan
    sqlite.prepare("DELETE FROM items_vault WHERE id = ?").run(id);

    expect(() => migrateV23toV24(sqlite)).not.toThrow();
    expect(getSchemaVersion(sqlite)).toBe(24);
  });

  it("halts with V24HaltError(unparseable) when frontmatter readFile errors", () => {
    sqlite
      .prepare(
        "INSERT INTO vault_files (path, title, frontmatter, content, mtime, content_hash, sparkle_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("0_Inbox/Missing.md", "Missing", null, "", 1, "h3", null);
    // Note: file does NOT exist on disk → readFileSync throws ENOENT, which v24
    // explicitly tolerates (continue). To force "unparseable", create a directory
    // at the path so readFile throws EISDIR.
    mkdirSync(join(vaultRoot, "0_Inbox"), { recursive: true });
    mkdirSync(join(vaultRoot, "0_Inbox/IsADir.md"));
    sqlite
      .prepare(
        "INSERT INTO vault_files (path, title, frontmatter, content, mtime, content_hash, sparkle_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("0_Inbox/IsADir.md", "Dir", null, "", 1, "h4", null);

    let caught: V24HaltError | null = null;
    try {
      migrateV23toV24(sqlite);
    } catch (e) {
      if (e instanceof V24HaltError) caught = e;
      else throw e;
    }
    expect(caught).toBeTruthy();
    expect(caught?.haltPayload.event).toBe("migration_v24_halted_unparseable");
    expect(caught?.haltPayload.count).toBeGreaterThanOrEqual(1);
    expect(getSchemaVersion(sqlite)).toBe(23);
  });

  it("no-ops when obsidian is disabled (still bumps version)", () => {
    sqlite.prepare("UPDATE settings SET value = 'false' WHERE key = 'obsidian_enabled'").run();
    migrateV23toV24(sqlite);
    expect(getSchemaVersion(sqlite)).toBe(24);
  });
});

describe("haltAndExit: log-before-exit invariant", () => {
  it("logger.error fires before process.exit(78)", () => {
    const order: string[] = [];
    const errorSpy = vi.spyOn(logger, "error").mockImplementation((() => {
      order.push("logger.error");
    }) as never);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      order.push(`process.exit(${code})`);
      // Don't actually exit — let the test continue to assert order.
      return undefined as never;
    }) as never);

    const payload = {
      event: "migration_v24_halted_orphans" as const,
      count: 1,
      ids: ["aaaa-bbbb"],
      error: "test halt zh",
      error_en: "test halt en",
      docs: "see docs/migration-v24.md",
    };

    haltAndExit(payload, payload.event);

    expect(order).toEqual(["logger.error", "process.exit(78)"]);
    expect(errorSpy).toHaveBeenCalledWith(payload, "[migration_v24_halted_orphans]");

    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
