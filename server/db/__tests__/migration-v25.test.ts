import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, copyFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateV24toV25, V25HaltError } from "../index";

/** Build a v24-shaped DB with `export_path` + representative rows. */
function seedV24(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (24);

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
    CREATE INDEX idx_items_vault_exported_at ON items_vault(exported_at);

    INSERT INTO items_vault (id, title, export_path, exported_at, created, content_snippet)
    VALUES
      ('vault-1', 'Survives', '0_Inbox/survives.md', '2026-04-01', '2026-04-01', 'snip 1'),
      ('vault-2', 'Also survives', '0_Inbox/also.md', '2026-04-02', '2026-04-02', 'snip 2');

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

function getSchemaVersion(sqlite: Database.Database): number {
  return (sqlite.prepare("SELECT version FROM schema_version").get() as { version: number })
    .version;
}

function hasExportPathColumn(sqlite: Database.Database): boolean {
  const cols = sqlite.prepare("PRAGMA table_info(items_vault)").all() as { name: string }[];
  return cols.some((c) => c.name === "export_path");
}

describe("Migration v24→v25: drop items_vault.export_path + pre-flight backup", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    seedV24(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("drops export_path column without losing other data", () => {
    expect(hasExportPathColumn(sqlite)).toBe(true);

    migrateV24toV25(sqlite);

    expect(hasExportPathColumn(sqlite)).toBe(false);
    expect(getSchemaVersion(sqlite)).toBe(25);

    const rows = sqlite
      .prepare(`SELECT id, title, content_snippet FROM items_vault ORDER BY id`)
      .all();
    expect(rows).toEqual([
      { id: "vault-1", title: "Survives", content_snippet: "snip 1" },
      { id: "vault-2", title: "Also survives", content_snippet: "snip 2" },
    ]);
  });

  it("is idempotent — second run is a no-op (column already gone)", () => {
    migrateV24toV25(sqlite);
    expect(getSchemaVersion(sqlite)).toBe(25);

    expect(() => migrateV24toV25(sqlite)).not.toThrow();
    expect(hasExportPathColumn(sqlite)).toBe(false);
    expect(getSchemaVersion(sqlite)).toBe(25);
  });

  it("skips backup for in-memory databases (test-mode invariant)", () => {
    // No SPARKLE_MIGRATION_BACKUP_DIR override; in-memory branch must not touch
    // the filesystem. If it did, statSync(":memory:") would throw ENOENT.
    expect(() => migrateV24toV25(sqlite)).not.toThrow();
  });
});

describe("Migration v25: file-backed DB backup branch", () => {
  let dbDir: string;
  let backupDir: string;
  let dbPath: string;
  let sqlite: Database.Database;

  beforeEach(() => {
    dbDir = mkdtempSync(join(tmpdir(), "sparkle-v25-db-"));
    backupDir = mkdtempSync(join(tmpdir(), "sparkle-v25-backup-"));
    dbPath = join(dbDir, "todo.db");
    sqlite = new Database(dbPath);
    seedV24(sqlite);
    process.env.SPARKLE_MIGRATION_BACKUP_DIR = backupDir;
  });

  afterEach(() => {
    sqlite.close();
    delete process.env.SPARKLE_MIGRATION_BACKUP_DIR;
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(backupDir, { recursive: true, force: true });
  });

  it("creates a VACUUM INTO backup file before dropping the column", () => {
    const before = readdirSync(backupDir);
    expect(before).toEqual([]);

    migrateV24toV25(sqlite);

    const after = readdirSync(backupDir);
    expect(after.length).toBe(1);
    expect(after[0]).toMatch(/^todo\.db\.bak-pre-v25-\d+-\d+-[0-9a-f]{8}$/);
    const backupSize = statSync(join(backupDir, after[0]!)).size;
    expect(backupSize).toBeGreaterThan(0);

    expect(hasExportPathColumn(sqlite)).toBe(false);
    expect(getSchemaVersion(sqlite)).toBe(25);
  });

  it("backup file is a queryable SQLite DB containing the pre-drop schema", () => {
    migrateV24toV25(sqlite);
    const [backupName] = readdirSync(backupDir);
    const backup = new Database(join(backupDir, backupName!), { readonly: true });
    try {
      // Backup retains the v24 schema (export_path still present) and the
      // pre-migration row data, so an operator can roll back via cp + restart.
      const cols = backup.prepare("PRAGMA table_info(items_vault)").all() as { name: string }[];
      expect(cols.some((c) => c.name === "export_path")).toBe(true);
      const rows = backup.prepare("SELECT id, export_path FROM items_vault ORDER BY id").all() as {
        id: string;
        export_path: string | null;
      }[];
      expect(rows).toEqual([
        { id: "vault-1", export_path: "0_Inbox/survives.md" },
        { id: "vault-2", export_path: "0_Inbox/also.md" },
      ]);
    } finally {
      backup.close();
    }
  });

  it("halts with migration_v25_halted_backup_failed when backup target is unwritable", () => {
    // Make the backup dir non-writable to force VACUUM INTO failure. On filesystems
    // without unix perms the chmod is silently ignored; in that case we replace the
    // backup dir with a path-as-file to provoke the same write failure.
    const blockerPath = join(backupDir, "blocker.db.bak-pre-v25-blocked");
    writeFileSync(blockerPath, "");
    process.env.SPARKLE_MIGRATION_BACKUP_DIR = blockerPath; // pointing at a file, not a dir

    let caught: V25HaltError | null = null;
    try {
      migrateV24toV25(sqlite);
    } catch (e) {
      if (e instanceof V25HaltError) caught = e;
      else throw e;
    }
    expect(caught).toBeInstanceOf(V25HaltError);
    expect(caught!.haltPayload.event).toBe("migration_v25_halted_backup_failed");
    // Schema unchanged — version stays at 24, column still present.
    expect(getSchemaVersion(sqlite)).toBe(24);
    expect(hasExportPathColumn(sqlite)).toBe(true);
  });

  // Note: the migration_v25_halted_no_disk path runs `statfsSync` directly,
  // which Vitest 4 cannot intercept under ESM (`Cannot spy on export — module
  // namespace is not configurable`). The pre-flight is exercised manually via
  // `ops/migration-25-dryrun.sh` against a tmpfs at the deploy target. If a
  // future refactor wraps statfsSync in an injectable, add a mocked test here.
});

describe("Migration v25: rollback-from-backup smoke", () => {
  it("file-backed backup can be restored over the live DB after a v25 migration", () => {
    const dbDir = mkdtempSync(join(tmpdir(), "sparkle-v25-restore-db-"));
    const backupDir = mkdtempSync(join(tmpdir(), "sparkle-v25-restore-backup-"));
    const dbPath = join(dbDir, "todo.db");
    process.env.SPARKLE_MIGRATION_BACKUP_DIR = backupDir;
    try {
      let sqlite = new Database(dbPath);
      seedV24(sqlite);
      migrateV24toV25(sqlite);
      sqlite.close();

      // Operator rollback: cp backup over live DB, drop WAL/SHM, reopen.
      const [backupName] = readdirSync(backupDir);
      copyFileSync(join(backupDir, backupName!), dbPath);
      for (const sidecar of ["todo.db-wal", "todo.db-shm"]) {
        rmSync(join(dbDir, sidecar), { force: true });
      }

      sqlite = new Database(dbPath);
      try {
        expect(getSchemaVersion(sqlite)).toBe(24);
        expect(hasExportPathColumn(sqlite)).toBe(true);
      } finally {
        sqlite.close();
      }
    } finally {
      delete process.env.SPARKLE_MIGRATION_BACKUP_DIR;
      rmSync(dbDir, { recursive: true, force: true });
      rmSync(backupDir, { recursive: true, force: true });
    }
  });
});
