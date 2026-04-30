import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { mkdirSync, readFileSync, statSync, statfsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as schema from "./schema.js";
import { setupFTS, setupVaultFTS } from "./fts.js";
import { logger } from "../lib/logger.js";
import { extractSparkleId } from "../lib/frontmatter.js";

const DB_PATH = process.env.DATABASE_URL || "./data/todo.db";

const TARGET_VERSION = 25;

/**
 * Migration v24 halt payload — bilingual operator-facing error.
 * Two halt categories surface separately so operators can decode `journalctl`
 * by event name and follow the right runbook section.
 */
export type V24HaltPayload = {
  event: "migration_v24_halted_orphans" | "migration_v24_halted_unparseable";
  count: number;
  ids?: string[];
  files?: Array<{ path: string; reason: string }>;
  error: string;
  error_en: string;
  docs: string;
};

export class V24HaltError extends Error {
  constructor(public readonly haltPayload: V24HaltPayload) {
    super(`[${haltPayload.event}] ${haltPayload.error_en}`);
    this.name = "V24HaltError";
  }
}

/**
 * Migration v25 halt payload — backup mechanism failed before DROP COLUMN.
 * Pairs with systemd `RestartPreventExitStatus=78` to stop the restart-loop.
 */
export type V25HaltPayload = {
  event: "migration_v25_halted_no_disk" | "migration_v25_halted_backup_failed";
  error: string;
  error_en: string;
  docs: string;
  backupPath?: string;
  requiredBytes?: number;
  freeBytes?: number;
};

export class V25HaltError extends Error {
  constructor(public readonly haltPayload: V25HaltPayload) {
    super(`[${haltPayload.event}] ${haltPayload.error_en}`);
    this.name = "V25HaltError";
  }
}

export type MigrationHaltPayload = V24HaltPayload | V25HaltPayload;

function getSchemaVersion(sqlite: Database.Database): number {
  // Check if schema_version table exists
  const tableExists = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'")
    .get();

  if (!tableExists) {
    sqlite.exec("CREATE TABLE schema_version (version INTEGER NOT NULL)");
    sqlite.exec("INSERT INTO schema_version (version) VALUES (0)");
    return 0;
  }

  const row = sqlite.prepare("SELECT version FROM schema_version").get() as
    | { version: number }
    | undefined;

  if (!row) {
    sqlite.exec("INSERT INTO schema_version (version) VALUES (0)");
    return 0;
  }

  return row.version;
}

function setSchemaVersion(sqlite: Database.Database, version: number) {
  sqlite.prepare("UPDATE schema_version SET version = ?").run(version);
}

function runMigrations(sqlite: Database.Database) {
  const version = getSchemaVersion(sqlite);

  if (version >= TARGET_VERSION) return;

  // Step 0→1: Rename source → origin
  if (version < 1) {
    try {
      sqlite.exec("ALTER TABLE items RENAME COLUMN source TO origin");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("no such column")) throw e;
    }
    setSchemaVersion(sqlite, 1);
  }

  // Step 1→2: Rename created_at → created
  if (version < 2) {
    try {
      sqlite.exec("ALTER TABLE items RENAME COLUMN created_at TO created");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("no such column")) throw e;
    }
    setSchemaVersion(sqlite, 2);
  }

  // Step 2→3: Rename updated_at → modified
  if (version < 3) {
    try {
      sqlite.exec("ALTER TABLE items RENAME COLUMN updated_at TO modified");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("no such column")) throw e;
    }
    setSchemaVersion(sqlite, 3);
  }

  // Step 3→4: Rename due_date → due
  if (version < 4) {
    try {
      sqlite.exec("ALTER TABLE items RENAME COLUMN due_date TO due");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("no such column")) throw e;
    }
    setSchemaVersion(sqlite, 4);
  }

  // Step 4→5: Add source column (URL reference)
  if (version < 5) {
    try {
      sqlite.exec("ALTER TABLE items ADD COLUMN source TEXT DEFAULT NULL");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }
    setSchemaVersion(sqlite, 5);
  }

  // Step 5→6: Add aliases column
  if (version < 6) {
    try {
      sqlite.exec("ALTER TABLE items ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]'");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }
    setSchemaVersion(sqlite, 6);
  }

  // Step 6→7: Migrate status values (in transaction)
  if (version < 7) {
    const migrateStatuses = sqlite.transaction(() => {
      sqlite.exec("UPDATE items SET status = 'fleeting' WHERE type = 'note' AND status = 'inbox'");
      sqlite.exec(
        "UPDATE items SET status = 'developing' WHERE type = 'note' AND status = 'active'",
      );
      sqlite.exec("UPDATE items SET status = 'permanent' WHERE type = 'note' AND status = 'done'");
      sqlite.exec("UPDATE items SET status = 'active' WHERE type = 'todo' AND status = 'inbox'");
      // todo active/done/archived unchanged
    });
    migrateStatuses();
    setSchemaVersion(sqlite, 7);
  }

  // Step 7→8: Add linked_note_id column
  if (version < 8) {
    try {
      sqlite.exec("ALTER TABLE items ADD COLUMN linked_note_id TEXT DEFAULT NULL");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }
    setSchemaVersion(sqlite, 8);
  }

  // Step 8→9: Create settings table with defaults
  if (version < 9) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT OR IGNORE INTO settings (key, value) VALUES
        ('obsidian_enabled', 'false'),
        ('obsidian_vault_path', ''),
        ('obsidian_inbox_folder', '0_Inbox'),
        ('obsidian_export_mode', 'overwrite');
    `);
    setSchemaVersion(sqlite, 9);
  }

  // Step 9→10: Add scratch type support (no schema change needed for SQLite text columns)
  if (version < 10) {
    setSchemaVersion(sqlite, 10);
  }

  // Step 10→11: Create share_tokens table
  if (version < 11) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS share_tokens (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        visibility TEXT NOT NULL DEFAULT 'unlisted',
        created TEXT NOT NULL,
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_share_tokens_token ON share_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_share_tokens_item_id ON share_tokens(item_id);
    `);
    setSchemaVersion(sqlite, 11);
  }

  // Step 11→12: Add FK constraint on linked_note_id (table recreation required)
  if (version < 12) {
    sqlite.pragma("foreign_keys = OFF");

    const migrate = sqlite.transaction(() => {
      // Clean up orphan linked_note_id references
      sqlite.exec(`
        UPDATE items SET linked_note_id = NULL
        WHERE linked_note_id IS NOT NULL
        AND linked_note_id NOT IN (SELECT id FROM items)
      `);

      // Fix legacy NULL values in NOT NULL columns before table recreation
      sqlite.exec(`
        UPDATE items SET modified = created WHERE modified IS NULL;
        UPDATE items SET modified = datetime('now') WHERE modified IS NULL AND created IS NULL;
        UPDATE items SET created = modified WHERE created IS NULL;
        UPDATE items SET created = datetime('now') WHERE created IS NULL;
      `);

      // Recreate table with FK (SQLite can't ALTER TABLE to add FK)
      sqlite.exec(`
        CREATE TABLE items_new (
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

        INSERT INTO items_new (id, type, title, content, status, priority, due, tags, origin, source, aliases, linked_note_id, created, modified)
        SELECT id, type, title, content, status, priority, due, tags, origin, source, aliases, linked_note_id, created, modified FROM items;
        DROP TABLE items;
        ALTER TABLE items_new RENAME TO items;

        CREATE INDEX idx_items_status ON items(status);
        CREATE INDEX idx_items_type ON items(type);
        CREATE INDEX idx_items_created ON items(created DESC);
      `);
    });

    migrate();

    sqlite.pragma("foreign_keys = ON");

    // Verify FK integrity after migration
    const violations = sqlite.pragma("foreign_key_check(items)");
    if (Array.isArray(violations) && violations.length > 0) {
      throw new Error(
        `FK integrity check failed after migration 11→12: ${JSON.stringify(violations)}`,
      );
    }

    setSchemaVersion(sqlite, 12);
  }

  // Step 12→13: Create categories table + add category_id to items
  if (version < 13) {
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

    try {
      sqlite.exec("CREATE INDEX IF NOT EXISTS idx_items_category_id ON items(category_id)");
    } catch {
      // Index may already exist
    }

    setSchemaVersion(sqlite, 13);
  }

  // Step 13→14: Add viewed_at column + dashboard settings
  if (version < 14) {
    try {
      sqlite.exec("ALTER TABLE items ADD COLUMN viewed_at TEXT DEFAULT NULL");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }

    sqlite.exec("CREATE INDEX IF NOT EXISTS idx_items_viewed_at ON items(viewed_at)");
    sqlite.exec("CREATE INDEX IF NOT EXISTS idx_items_status_modified ON items(status, modified)");

    // Mark all existing items as viewed (start with clean inbox)
    sqlite.exec("UPDATE items SET viewed_at = created WHERE viewed_at IS NULL");

    // Dashboard settings
    sqlite.exec(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('recent_days', '7');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('stale_days', '14');
    `);

    setSchemaVersion(sqlite, 14);
  }

  // Step 14→15: Add is_private column + composite indexes
  if (version < 15) {
    try {
      sqlite.exec("ALTER TABLE items ADD COLUMN is_private INTEGER DEFAULT 0");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }

    sqlite.exec("CREATE INDEX IF NOT EXISTS idx_items_private_status ON items(is_private, status)");
    sqlite.exec(
      "CREATE INDEX IF NOT EXISTS idx_items_private_status_modified ON items(is_private, status, modified)",
    );

    setSchemaVersion(sqlite, 15);
  }

  // Step 15→16: Add daily note settings defaults
  if (version < 16) {
    sqlite.exec(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('obsidian_daily_folder', 'Daily');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('daily_note_time', '23:00');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('daily_note_mode', 'subfolder');
    `);
    setSchemaVersion(sqlite, 16);
  }

  // Step 16→17: Add LINE brief settings defaults
  if (version < 17) {
    sqlite.exec(`
      INSERT OR IGNORE INTO settings (key, value) VALUES ('line_brief_enabled', 'false');
      INSERT OR IGNORE INTO settings (key, value) VALUES ('line_brief_time', '21:00');
    `);
    setSchemaVersion(sqlite, 17);
  }

  // Step 17→18: Add paused flag columns
  if (version < 18) {
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
    setSchemaVersion(sqlite, 18);
  }

  // Step 18→19: Seed daily_note_enabled for existing installations
  if (version < 19) {
    sqlite.exec(
      "INSERT OR IGNORE INTO settings (key, value) VALUES ('daily_note_enabled', 'true')",
    );
    setSchemaVersion(sqlite, 19);
  }

  // Step 19→20: Add export_path column for vault sync
  if (version < 20) {
    try {
      sqlite.exec("ALTER TABLE items ADD COLUMN export_path TEXT DEFAULT NULL");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }
    setSchemaVersion(sqlite, 20);
  }

  // Step 20→21: Create vault_files table for vault browse
  if (version < 21) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS vault_files (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        frontmatter TEXT,
        content TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        content_hash TEXT NOT NULL
      )
    `);
    setSchemaVersion(sqlite, 21);
  }

  // Step 21→22: Add sparkle_id to vault_files for Sparkle source tracking
  if (version < 22) {
    try {
      sqlite.exec("ALTER TABLE vault_files ADD COLUMN sparkle_id TEXT DEFAULT NULL");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }
    // Unique partial index: prevent duplicate sparkle_ids
    sqlite.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_files_sparkle_id ON vault_files(sparkle_id) WHERE sparkle_id IS NOT NULL",
    );
    // Force re-scan of files with sparkle_id in frontmatter so scanner fills the new column
    // Must also reset mtime to 0 — scanner checks mtime before content_hash
    sqlite.exec(
      "UPDATE vault_files SET content_hash = '', mtime = 0 WHERE frontmatter LIKE '%sparkle_id%'",
    );
    setSchemaVersion(sqlite, 22);
  }

  // Step 22→23: Split items → items_active + items_vault (see docs/migration-v23.md)
  if (version < 23) {
    migrateV22toV23(sqlite);
  }

  // Step 23→24: Backfill vault_files.sparkle_id from .md frontmatter, then
  // verify every items_vault row reverse-looks-up. See docs/migration-v24.md.
  if (version < 24) {
    migrateV23toV24(sqlite);
  }

  // Step 24→25: Drop items_vault.export_path. vault_files.sparkle_id reverse-lookup
  // is the sole source of truth post-v25. Pre-flight backup via VACUUM INTO.
  // See docs/migration-v25.md.
  if (version < 25) {
    migrateV24toV25(sqlite);
  }
}

/**
 * Default backup directory — matches the existing restic repo location used by
 * scripts/backup.sh. Operators with `~/sparkle-backups/` already populated get
 * pre-migration snapshots alongside their daily backups.
 *
 * Override via SPARKLE_MIGRATION_BACKUP_DIR (test fixtures use the DB's parent
 * directory to keep tmp-dir isolation).
 */
function getMigrationBackupDir(): string {
  return process.env.SPARKLE_MIGRATION_BACKUP_DIR ?? join(homedir(), "sparkle-backups");
}

/**
 * Migration 24→25: Drop items_vault.export_path. Pre-condition for the column
 * drop is a hot-DB-safe backup: VACUUM INTO yields a WAL-consistent copy and
 * is synchronous in better-sqlite3 7.x+ (verified 12.6.x). fs.copyFileSync
 * would race the WAL — VACUUM INTO does not.
 *
 * Two halt categories:
 *   - migration_v25_halted_no_disk     — statfs free space < required (1.2× DB size)
 *   - migration_v25_halted_backup_failed — VACUUM INTO threw (permission, IO, etc.)
 *
 * On halt, V25HaltError is thrown; createDb catches and routes through
 * haltAndExit → process.exit(78) to pair with systemd RestartPreventExitStatus.
 *
 * After backup succeeds, ALTER TABLE DROP COLUMN runs inside a transaction
 * with setSchemaVersion(25). All-or-nothing — if DROP COLUMN throws (e.g. an
 * unexpected CHECK constraint references export_path) the version stays at 24
 * and the operator can restore from the backup.
 */
export function migrateV24toV25(sqlite: Database.Database): void {
  // Idempotency early-out: if the column is already gone (operator manually
  // reset schema_version to 24 after a successful v25, or a previous run
  // crashed between DROP and setSchemaVersion), skip the expensive backup
  // and just bump the version.
  const cols = sqlite.prepare("PRAGMA table_info(items_vault)").all() as { name: string }[];
  const hasExportPath = cols.some((c) => c.name === "export_path");
  if (!hasExportPath) {
    setSchemaVersion(sqlite, 25);
    return;
  }

  const dbPath = sqlite.name;
  const isInMemory = dbPath === ":memory:" || dbPath === "";

  // In-memory DBs (tests) have nothing on disk to back up; skip straight to
  // the DROP. Production paths always pass a real file path here.
  if (!isInMemory) {
    const backupDir = getMigrationBackupDir();
    const backupPath = join(backupDir, `todo.db.bak-pre-v25-${Date.now()}`);

    try {
      mkdirSync(backupDir, { recursive: true });
      const dbStat = statSync(dbPath);
      const fsStat = statfsSync(backupDir);
      const freeBytes = Number(fsStat.bavail) * Number(fsStat.bsize);
      const requiredBytes = Math.ceil(dbStat.size * 1.2);

      if (freeBytes < requiredBytes) {
        throw new V25HaltError({
          event: "migration_v25_halted_no_disk",
          requiredBytes,
          freeBytes,
          backupPath: backupDir,
          error: `Migration v25 需要至少 ${Math.ceil(requiredBytes / 1e6)}MB 可用空間於 ${backupDir}（目前剩餘 ${Math.floor(freeBytes / 1e6)}MB）。請釋出磁碟空間後重啟 sparkle。詳見 docs/migration-v25.md#disk-space`,
          error_en: `Migration v25 requires at least ${Math.ceil(requiredBytes / 1e6)}MB free at ${backupDir} (have ${Math.floor(freeBytes / 1e6)}MB). Free space then restart sparkle.`,
          docs: "see docs/migration-v25.md#disk-space",
        });
      }

      // VACUUM INTO is sync in better-sqlite3 7.x+, atomic, WAL-consistent.
      // fs.copyFileSync would race the WAL — VACUUM INTO does not.
      if (dbStat.size > 500_000_000) {
        logger.warn(
          { event: "migration_v25_large_db", sizeBytes: dbStat.size },
          `migration v25: VACUUM INTO ${Math.round(dbStat.size / 1e6)}MB DB may take several minutes`,
        );
      }
      sqlite.prepare("VACUUM INTO ?").run(backupPath);

      const backupStat = statSync(backupPath);
      logger.info(
        {
          event: "migration_v25_backup_created",
          backupPath,
          sizeBytes: backupStat.size,
          freeBytesAfter: freeBytes - backupStat.size,
        },
        `migration v25: pre-migration backup created at ${backupPath}`,
      );
    } catch (e) {
      if (e instanceof V25HaltError) throw e;
      throw new V25HaltError({
        event: "migration_v25_halted_backup_failed",
        backupPath,
        error: `Migration v25 backup 失敗：${(e as Error).message}。請檢查 ${backupDir} 權限與磁碟健康後重啟 sparkle。詳見 docs/migration-v25.md#backup-failed`,
        error_en: `Migration v25 backup failed: ${(e as Error).message}. Check ${backupDir} permissions and disk health, then restart sparkle.`,
        docs: "see docs/migration-v25.md#backup-failed",
      });
    }
  }

  // DROP COLUMN inside a tx so a mid-statement crash leaves the column intact;
  // setSchemaVersion runs AFTER the tx commits so a DROP failure leaves
  // version at 24 (operator restores from the backup before retrying).
  const tx = sqlite.transaction(() => {
    sqlite.exec("ALTER TABLE items_vault DROP COLUMN export_path");
  });
  tx();
  setSchemaVersion(sqlite, 25);

  logger.info(
    { event: "migration_v25_complete" },
    "migration v25: dropped items_vault.export_path",
  );
}

/**
 * Migration 23→24: Backfill vault_files.sparkle_id from on-disk frontmatter,
 * then verify every items_vault row has a reverse-lookup match.
 *
 * Two-phase to keep async I/O outside the transaction:
 *   PHASE 1 (sync I/O, outside tx): scan .md frontmatter, accumulate updates
 *           Map and unparseable list. ENOENT/missing-frontmatter is NOT an
 *           error — it is the legitimate non-Sparkle .md case.
 *   PHASE 2 (sync tx): bulk UPDATE vault_files.sparkle_id, orphan check,
 *           setSchemaVersion(24). All-or-nothing — orphan detection rolls
 *           back the entire phase.
 *
 * On halt (either category) the function throws V24HaltError. The startup
 * caller logs the bilingual payload, flushes pino, then process.exit(78)
 * (EX_CONFIG — paired with systemd RestartPreventExitStatus=78 to stop the
 * restart-loop bug pre-PR-2 systemd unit-file change).
 */
export function migrateV23toV24(sqlite: Database.Database): void {
  const obsidianEnabled = sqlite
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("obsidian_enabled") as { value: string } | undefined;
  const obsidianVaultPath = sqlite
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get("obsidian_vault_path") as { value: string } | undefined;

  // No vault configured: nothing to backfill or check, just bump version.
  if (!obsidianEnabled || obsidianEnabled.value !== "true" || !obsidianVaultPath?.value) {
    setSchemaVersion(sqlite, 24);
    return;
  }

  const vaultPath = obsidianVaultPath.value;

  // PHASE 1 — sync I/O, outside any transaction
  const needsBackfill = sqlite
    .prepare("SELECT path FROM vault_files WHERE sparkle_id IS NULL")
    .all() as { path: string }[];

  const updates = new Map<string, string>();
  const unparseable: Array<{ path: string; reason: string }> = [];

  for (const row of needsBackfill) {
    try {
      const content = readFileSync(join(vaultPath, row.path), "utf-8");
      const sparkleId = extractSparkleId(content);
      if (sparkleId) updates.set(row.path, sparkleId);
      // null result = legitimate non-Sparkle .md (no frontmatter, or no sparkle_id key) — skip silently
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      // ENOENT = file deleted between scanner index and migration — not an error
      if (code === "ENOENT") continue;
      unparseable.push({ path: row.path, reason: (e as Error).message });
    }
  }

  if (unparseable.length > 0) {
    throw new V24HaltError({
      event: "migration_v24_halted_unparseable",
      count: unparseable.length,
      files: unparseable.slice(0, 10),
      error: `${unparseable.length} 個 .md 檔案無法讀取或 frontmatter 格式錯誤。請修正或移除上列 paths 後重啟 sparkle。詳見 docs/migration-v24.md#troubleshooting-unparseable-frontmatter`,
      error_en: `${unparseable.length} .md files have unreadable frontmatter or filesystem errors. Inspect listed paths and fix or move them, then restart sparkle.`,
      docs: "see docs/migration-v24.md#troubleshooting-unparseable-frontmatter",
    });
  }

  // PHASE 2 — sync tx: backfill + orphan check + version bump (atomic)
  const tx = sqlite.transaction(() => {
    const upd = sqlite.prepare("UPDATE vault_files SET sparkle_id = ? WHERE path = ?");
    for (const [path, sparkleId] of updates) {
      upd.run(sparkleId, path);
    }

    const orphans = sqlite
      .prepare(
        `SELECT iv.id, iv.title FROM items_vault iv
           WHERE NOT EXISTS (
             SELECT 1 FROM vault_files vf WHERE vf.sparkle_id = iv.id
           )`,
      )
      .all() as { id: string; title: string }[];

    if (orphans.length > 0) {
      throw new V24HaltError({
        event: "migration_v24_halted_orphans",
        count: orphans.length,
        ids: orphans.slice(0, 5).map((o) => o.id),
        error: `${orphans.length} 個 items_vault 找不到對應 vault_files。執行 npm run vault:audit 解 orphans 後重啟 sparkle。詳見 docs/migration-v24.md#when-v24-halts-on-orphans`,
        error_en: `${orphans.length} items_vault rows have no vault_files match. Run \`npm run vault:audit\` to resolve, then restart sparkle.`,
        docs: "see docs/migration-v24.md#when-v24-halts-on-orphans",
      });
    }

    setSchemaVersion(sqlite, 24);
  });
  tx();

  if (updates.size > 0) {
    logger.info(
      { event: "migration_v24_complete", backfilled: updates.size },
      `migration v24: backfilled ${updates.size} vault_files.sparkle_id from frontmatter`,
    );
  }
}

export function migrateV22toV23(sqlite: Database.Database) {
  // Idempotency: detect partial-completion states before running.
  const schemaRows = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('items','items_active','items_vault')",
    )
    .all() as { name: string }[];
  const have = new Set(schemaRows.map((r) => r.name));

  // State A: only legacy `items` table → run full Stage A+B
  // State B: items_active exists but FTS empty → only rebuild FTS
  // State C: items_active exists and FTS populated → only bump version
  const hasLegacy = have.has("items");
  const hasActive = have.has("items_active");

  if (!hasLegacy && hasActive) {
    // State B or C: schema already split. Always run Stage B (CREATE INDEX IF NOT
    // EXISTS is idempotent) so that a crash between Stage A commit and Stage B
    // reaching setSchemaVersion doesn't leave the DB without its indexes.
    runStageBIndexes(sqlite);
    // Always rebuild FTS: external-content FTS5 virtual tables report the content
    // table's row count for `COUNT(*)`, so there's no cheap runtime probe that
    // tells us whether the shadow index is populated. Rebuild is idempotent and
    // cheap at the expected row volume (<500).
    try {
      sqlite.exec("INSERT INTO items_active_fts(items_active_fts) VALUES ('rebuild')");
    } catch {
      // items_active_fts not created yet — setupFTS will build it after migrations
    }
    setSchemaVersion(sqlite, 23);
    return;
  }

  if (!hasLegacy && !hasActive) {
    // Neither table exists. This is an inconsistent state — runMigrations was only
    // called because schema_version < 23 yet the legacy `items` table is missing.
    // Rather than silently stamping v23 on a broken DB, fail loudly so the operator
    // can restore from backup.
    throw new Error(
      "Migration 23: inconsistent state — schema_version < 23 but neither `items` nor `items_active` exists. Restore from backup before continuing.",
    );
  }

  // Pre-scan: items that would violate items_active CHECK constraint. Surface
  // offending rows by id so the operator doesn't hit a cryptic "CHECK constraint
  // failed" inside the transaction.
  const constraintViolators = sqlite
    .prepare(
      `SELECT id, type, status FROM items
       WHERE status != 'exported'
         AND NOT (
           (type = 'note' AND status IN ('fleeting','developing','permanent','archived')) OR
           (type = 'todo' AND status IN ('active','done','archived')) OR
           (type = 'scratch' AND status IN ('draft','archived'))
         )`,
    )
    .all() as { id: string; type: string; status: string }[];
  if (constraintViolators.length > 0) {
    throw new Error(
      `Migration 23: ${constraintViolators.length} rows violate items_active CHECK constraint. Fix them in the legacy items table before retrying. Violators: ${JSON.stringify(
        constraintViolators.slice(0, 10),
      )}`,
    );
  }

  sqlite.pragma("foreign_keys = OFF");

  try {
    const runStageA = sqlite.transaction(() => {
      // A-0. Cross-table linked_note_id cleanup (D12): null out active→vault refs
      //      before split so items_active FK does not violate.
      const cleanupCount =
        (
          sqlite
            .prepare(
              `SELECT COUNT(*) AS n FROM items
           WHERE linked_note_id IS NOT NULL
             AND linked_note_id IN (SELECT id FROM items WHERE status = 'exported')
             AND status != 'exported'`,
            )
            .get() as { n: number } | undefined
        )?.n ?? 0;
      if (cleanupCount > 0) {
        logger.info(
          `Migration 23: clearing ${cleanupCount} linked_note_id references pointing from active items to exported items`,
        );
      }
      sqlite.exec(`
        UPDATE items SET linked_note_id = NULL
        WHERE linked_note_id IS NOT NULL
          AND linked_note_id IN (SELECT id FROM items WHERE status = 'exported')
          AND status != 'exported';
      `);

      // A-1. items_active: status-bearing table (D15 viewed_at, D16 category_id FK,
      //      D17 content default, D1 linked_note_id FK).
      sqlite.exec(`
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
        modified TEXT NOT NULL,
        CHECK (
          (type = 'note' AND status IN ('fleeting', 'developing', 'permanent', 'archived')) OR
          (type = 'todo' AND status IN ('active', 'done', 'archived')) OR
          (type = 'scratch' AND status IN ('draft', 'archived'))
        ),
        FOREIGN KEY (linked_note_id) REFERENCES items_active(id) ON DELETE SET NULL,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      );
    `);

      // A-2. items_vault: metadata + immutable preview cache (D11 content_snippet,
      //      D16 category_id FK, D18 export_path items_vault-only).
      sqlite.exec(`
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
        content_snippet TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      );
    `);

      // A-3. Data migration → items_active
      sqlite.exec(`
      INSERT INTO items_active (
        id, type, status, title, content, is_private, category_id, priority, due,
        tags, aliases, source, origin, linked_note_id, viewed_at,
        paused, paused_at, paused_context, created, modified
      )
      SELECT id, type, status, title, COALESCE(content, ''), COALESCE(is_private, 0), category_id,
             priority, due, tags, aliases, source, origin, linked_note_id, viewed_at,
             paused, paused_at, paused_context, created, modified
      FROM items WHERE status != 'exported';
    `);

      // A-4. Data migration → items_vault (content_snippet derived from content)
      sqlite.exec(`
      INSERT INTO items_vault (
        id, title, category_id, tags, aliases, source, origin,
        export_path, exported_at, created, is_private, content_snippet
      )
      SELECT id, title, category_id, tags, aliases, source, origin,
             export_path, modified, created, COALESCE(is_private, 0),
             COALESCE(SUBSTR(content, 1, 500), '')
      FROM items WHERE status = 'exported';
    `);

      // A-5. Rebuild share_tokens with FK → items_active (drops tokens for exported items).
      const dropCount =
        (
          sqlite
            .prepare(
              `SELECT COUNT(*) AS n FROM share_tokens WHERE item_id IN (SELECT id FROM items WHERE status = 'exported')`,
            )
            .get() as { n: number } | undefined
        )?.n ?? 0;
      if (dropCount > 0) {
        logger.info(`Migration 23: dropping ${dropCount} share_tokens referencing exported items`);
      }
      sqlite.exec(`
      CREATE TABLE share_tokens_new (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        visibility TEXT NOT NULL DEFAULT 'unlisted',
        created TEXT NOT NULL,
        FOREIGN KEY (item_id) REFERENCES items_active(id) ON DELETE CASCADE
      );
      INSERT INTO share_tokens_new (id, item_id, token, visibility, created)
        SELECT id, item_id, token, visibility, created
        FROM share_tokens
        WHERE item_id IN (SELECT id FROM items_active);
      DROP TABLE share_tokens;
      ALTER TABLE share_tokens_new RENAME TO share_tokens;
    `);

      // A-6. Drop legacy triggers + items + items_fts.
      sqlite.exec(`
      DROP TRIGGER IF EXISTS items_ai;
      DROP TRIGGER IF EXISTS items_ad;
      DROP TRIGGER IF EXISTS items_au;
      DROP TABLE items;
      DROP TABLE IF EXISTS items_fts;
    `);

      // A-7. FTS5 external-content (D13, R4-FINDING-6 — keep 2-column scope to match legacy fts.ts).
      sqlite.exec(`
        CREATE VIRTUAL TABLE items_active_fts USING fts5(
          title, content,
          content = items_active,
          content_rowid = rowid,
          tokenize = 'trigram'
        );
        CREATE TRIGGER items_active_ai AFTER INSERT ON items_active BEGIN
          INSERT INTO items_active_fts(rowid, title, content)
          VALUES (new.rowid, new.title, new.content);
        END;
        CREATE TRIGGER items_active_ad AFTER DELETE ON items_active BEGIN
          INSERT INTO items_active_fts(items_active_fts, rowid, title, content)
          VALUES ('delete', old.rowid, old.title, old.content);
        END;
        CREATE TRIGGER items_active_au AFTER UPDATE ON items_active BEGIN
          INSERT INTO items_active_fts(items_active_fts, rowid, title, content)
          VALUES ('delete', old.rowid, old.title, old.content);
          INSERT INTO items_active_fts(rowid, title, content)
          VALUES (new.rowid, new.title, new.content);
        END;
      `);
    });

    runStageA();
  } finally {
    // Always restore FK enforcement, even if Stage A throws. Leaving the pragma
    // OFF on a long-lived connection silently disables FK checks for every
    // subsequent query.
    sqlite.pragma("foreign_keys = ON");
  }

  // FK validation (D15 + D16 post-check)
  const activeViolations = sqlite.pragma("foreign_key_check(items_active)") as unknown[];
  const vaultViolations = sqlite.pragma("foreign_key_check(items_vault)") as unknown[];
  if (activeViolations.length > 0 || vaultViolations.length > 0) {
    throw new Error(
      `Migration 23 FK violations: active=${JSON.stringify(activeViolations)} vault=${JSON.stringify(vaultViolations)}`,
    );
  }

  // Stage B: indexes + FTS rebuild (outside transaction).
  runStageBIndexes(sqlite);
  sqlite.exec(`INSERT INTO items_active_fts(items_active_fts) VALUES ('rebuild');`);

  setSchemaVersion(sqlite, 23);
}

function runStageBIndexes(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_items_active_type_status ON items_active(type, status);
    CREATE INDEX IF NOT EXISTS idx_items_active_category_id ON items_active(category_id);
    CREATE INDEX IF NOT EXISTS idx_items_active_paused ON items_active(paused) WHERE paused = 1;
    CREATE INDEX IF NOT EXISTS idx_items_active_modified ON items_active(modified);
    CREATE INDEX IF NOT EXISTS idx_items_active_due ON items_active(due) WHERE due IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_items_active_linked_note_id
      ON items_active(linked_note_id) WHERE linked_note_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_items_active_viewed_at ON items_active(viewed_at);

    CREATE INDEX IF NOT EXISTS idx_items_vault_category_id ON items_vault(category_id);
    CREATE INDEX IF NOT EXISTS idx_items_vault_exported_at ON items_vault(exported_at);

    CREATE INDEX IF NOT EXISTS idx_share_tokens_token ON share_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_share_tokens_item_id ON share_tokens(item_id);
  `);
}

export function initializeDatabase(sqlite: Database.Database) {
  // Check if either the legacy items table OR the new items_active table exists.
  const existing = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('items', 'items_active')",
    )
    .all() as { name: string }[];
  const tableExists = existing.length > 0;

  if (!tableExists) {
    // Fresh install: categories must exist before items_active/items_vault since
    // both tables declare FOREIGN KEY (category_id) REFERENCES categories(id).
    sqlite.exec(`
      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        color TEXT DEFAULT NULL,
        created TEXT NOT NULL,
        modified TEXT NOT NULL
      );
      CREATE INDEX idx_categories_sort_order ON categories(sort_order);

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
        modified TEXT NOT NULL,
        CHECK (
          (type = 'note' AND status IN ('fleeting', 'developing', 'permanent', 'archived')) OR
          (type = 'todo' AND status IN ('active', 'done', 'archived')) OR
          (type = 'scratch' AND status IN ('draft', 'archived'))
        ),
        FOREIGN KEY (linked_note_id) REFERENCES items_active(id) ON DELETE SET NULL,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      );

      CREATE INDEX idx_items_active_type_status ON items_active(type, status);
      CREATE INDEX idx_items_active_category_id ON items_active(category_id);
      CREATE INDEX idx_items_active_modified ON items_active(modified);
      CREATE INDEX idx_items_active_viewed_at ON items_active(viewed_at);
      CREATE INDEX idx_items_active_paused ON items_active(paused) WHERE paused = 1;
      CREATE INDEX idx_items_active_due ON items_active(due) WHERE due IS NOT NULL;
      CREATE INDEX idx_items_active_linked_note_id
        ON items_active(linked_note_id) WHERE linked_note_id IS NOT NULL;

      CREATE TABLE items_vault (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category_id TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        aliases TEXT NOT NULL DEFAULT '[]',
        source TEXT,
        origin TEXT,
        exported_at TEXT NOT NULL,
        created TEXT NOT NULL,
        is_private INTEGER NOT NULL DEFAULT 0,
        content_snippet TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_items_vault_category_id ON items_vault(category_id);
      CREATE INDEX idx_items_vault_exported_at ON items_vault(exported_at);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO settings (key, value) VALUES
        ('obsidian_enabled', 'false'),
        ('obsidian_vault_path', ''),
        ('obsidian_inbox_folder', '0_Inbox'),
        ('obsidian_export_mode', 'overwrite'),
        ('recent_days', '7'),
        ('stale_days', '14'),
        ('obsidian_daily_folder', 'Daily'),
        ('daily_note_time', '23:00'),
        ('daily_note_enabled', 'true'),
        ('daily_note_mode', 'subfolder'),
        ('line_brief_enabled', 'false'),
        ('line_brief_time', '21:00');

      CREATE TABLE share_tokens (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        visibility TEXT NOT NULL DEFAULT 'unlisted',
        created TEXT NOT NULL,
        FOREIGN KEY (item_id) REFERENCES items_active(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_share_tokens_token ON share_tokens(token);
      CREATE INDEX idx_share_tokens_item_id ON share_tokens(item_id);

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
    `);

    // Set version to target directly for fresh installs
    sqlite.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
    sqlite.exec(`INSERT INTO schema_version (version) VALUES (${TARGET_VERSION})`);
  } else {
    // Existing database: run migrations
    runMigrations(sqlite);
  }

  setupFTS(sqlite);
  setupVaultFTS(sqlite);
}

/**
 * Migration halt handler: log bilingual payload, flush pino, then exit 78.
 *
 * Exit code 78 (EX_CONFIG) pairs with systemd `RestartPreventExitStatus=78`
 * in `scripts/systemd/sparkle.service`. Without that unit-file directive,
 * `Restart=always` would loop the halt and the operator never sees a stable
 * error window.
 *
 * Production pino has no transport (see lib/logger.ts), so writes are
 * synchronous and `flush()` is a no-op — the halt line lands in journalctl
 * before exit. The `flush()` call is defensive for any future transport
 * config; the no-callback form returns immediately.
 */
export function haltAndExit(payload: MigrationHaltPayload, event: string): never {
  logger.error(payload, `[${event}]`);
  if (typeof logger.flush === "function") {
    try {
      logger.flush();
    } catch {
      // flush errors are non-fatal — we're exiting anyway
    }
  }
  process.exit(78);
}

function createDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("journal_size_limit = 67108864");

  const db = drizzle(sqlite, { schema });

  try {
    initializeDatabase(sqlite);
  } catch (e) {
    if (e instanceof V24HaltError || e instanceof V25HaltError) {
      haltAndExit(e.haltPayload, e.haltPayload.event);
    }
    throw e;
  }

  // Checkpoint and truncate WAL to reclaim space from previous sessions
  try {
    const result = sqlite.pragma("wal_checkpoint(TRUNCATE)");
    if (Array.isArray(result) && result[0]?.busy) {
      logger.warn("WAL checkpoint blocked by another connection (busy=1), skipping");
    }
  } catch (e) {
    logger.error({ err: e }, "WAL checkpoint failed (non-fatal)");
  }

  return { db, sqlite };
}

// Cache on globalThis to avoid multiple connections in dev (tsx watch)
declare global {
  var __db: ReturnType<typeof createDb> | undefined;
}

function getDb() {
  if (!globalThis.__db) {
    globalThis.__db = createDb();
  }
  return globalThis.__db;
}

export const { db, sqlite } = getDb();
export { DB_PATH };
