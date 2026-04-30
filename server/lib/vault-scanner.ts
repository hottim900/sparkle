import { readFile, readdir, stat } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, basename, dirname, extname } from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import * as schema from "../db/schema.js";
import { vaultFiles } from "../db/schema.js";
import { getObsidianSettings } from "./settings.js";
import { extractFrontmatterBlock, extractSparkleId } from "./frontmatter.js";
import { logger } from "./logger.js";

type DB = BetterSQLite3Database<typeof schema>;

const SCAN_INTERVAL_MS = 5 * 60_000; // 5 minutes

const DEFAULT_AUDIT_PATH = join(process.cwd(), "quality", "duplicate-sparkle-id.json");

// Module-level concurrency guard — `setInterval` can fire while a previous scan
// is still running on a large vault, producing two parallel transactions.
let scanInProgress = false;

type DuplicateAuditEntry = {
  sparkle_id: string;
  new_path: string;
  detected: string;
};

/**
 * Append a duplicate-sparkle-id incident to the audit JSON file.
 * Surfaces in `vault:audit` CLI (PR 2). File is an array; created on first write.
 *
 * Capped at 1000 most recent entries — read-modify-write is O(N²) over many
 * conflicts in one scan, so a misconfigured vault with thousands of duplicate
 * sparkle_ids would otherwise stall the scanner. 1000 keeps worst-case bounded.
 */
const AUDIT_CAP = 1000;

export function appendDuplicateAuditEntry(
  entry: DuplicateAuditEntry,
  auditPath: string = DEFAULT_AUDIT_PATH,
): void {
  try {
    mkdirSync(dirname(auditPath), { recursive: true });
    let arr: DuplicateAuditEntry[] = [];
    if (existsSync(auditPath)) {
      const raw = readFileSync(auditPath, "utf-8").trim();
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) arr = parsed as DuplicateAuditEntry[];
      }
    }
    arr.push(entry);
    if (arr.length > AUDIT_CAP) arr = arr.slice(-AUDIT_CAP);
    writeFileSync(auditPath, JSON.stringify(arr, null, 2));
  } catch (e) {
    // Audit failure must never break the scan, but log the dropped entry so
    // operators can grep for incidents lost to disk-full / permission errors.
    logger.warn(
      `vault-scanner: failed to write duplicate audit entry ${JSON.stringify(entry)}: ${(e as Error).message}`,
    );
  }
}

/**
 * Extract title from a markdown file. Uses first H1 heading, or filename.
 */
function extractTitle(content: string, filename: string): string {
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match?.[1]) return h1Match[1].trim();
  return basename(filename, extname(filename));
}

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

type VaultFileData = {
  title: string;
  frontmatter: string | null;
  content: string;
  mtime: number;
  content_hash: string;
  sparkle_id: string | null;
};

/**
 * Insert or update a vault file entry, handling duplicate sparkle_id gracefully.
 * On UNIQUE constraint failure (two files share the same sparkle_id), retries with sparkle_id = null
 * AND appends a structured audit entry so `vault:audit` (PR 2) can surface the conflict.
 */
function upsertWithDupGuard(
  db: DB,
  relPath: string,
  data: VaultFileData,
  mode: "insert" | "update",
  auditPath: string,
): void {
  const run = (sparkleId: string | null) => {
    const payload = { ...data, sparkle_id: sparkleId };
    if (mode === "update") {
      db.update(vaultFiles).set(payload).where(eq(vaultFiles.path, relPath)).run();
    } else {
      db.insert(vaultFiles)
        .values({ path: relPath, ...payload })
        .run();
    }
  };

  try {
    run(data.sparkle_id);
  } catch (e) {
    const msg = (e as Error).message || "";
    if (msg.includes("UNIQUE constraint failed") && data.sparkle_id) {
      logger.warn(
        `vault-scanner: duplicate sparkle_id ${data.sparkle_id} in ${relPath}, setting to null`,
      );
      appendDuplicateAuditEntry(
        {
          sparkle_id: data.sparkle_id,
          new_path: relPath,
          detected: new Date().toISOString(),
        },
        auditPath,
      );
      run(null);
    } else {
      throw e;
    }
  }
}

/**
 * Recursively collect all .md file paths under a directory.
 * Excludes .obsidian/ directory.
 */
async function collectMdFiles(dir: string, vaultRoot: string): Promise<string[]> {
  const results: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip .obsidian config directory
      if (entry.name === ".obsidian") continue;
      // Skip hidden directories
      if (entry.name.startsWith(".")) continue;
      const subFiles = await collectMdFiles(fullPath, vaultRoot);
      results.push(...subFiles);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(relative(vaultRoot, fullPath));
    }
  }

  return results;
}

export type ScanOptions = {
  /** Override the duplicate-sparkle-id audit JSON path (tests). */
  auditPath?: string;
};

export type ScanResult = {
  scanned: number;
  inserted: number;
  updated: number;
  deleted: number;
  errors: number;
  /** True when the call short-circuited because another scan was already running. */
  skipped: boolean;
};

const EMPTY_RESULT = (skipped: boolean): ScanResult => ({
  scanned: 0,
  inserted: 0,
  updated: 0,
  deleted: 0,
  errors: 0,
  skipped,
});

/**
 * Full vault scan: index all .md files into vault_files table.
 * Uses content_hash to skip unchanged files. Removes deleted files from DB.
 *
 * Concurrent calls are skipped: only one scan runs at a time per process.
 */
export async function scanVaultFiles(
  db: DB,
  sqlite: Database.Database,
  options: ScanOptions = {},
): Promise<ScanResult> {
  if (scanInProgress) {
    logger.info("vault-scanner: previous scan still in progress, skipping this tick");
    return EMPTY_RESULT(true);
  }

  const obsidian = getObsidianSettings(sqlite);
  if (!obsidian.obsidian_enabled || !obsidian.obsidian_vault_path) {
    return EMPTY_RESULT(false);
  }

  scanInProgress = true;
  try {
    const auditPath = options.auditPath ?? DEFAULT_AUDIT_PATH;
    const upsert = (relPath: string, data: VaultFileData, mode: "insert" | "update") =>
      upsertWithDupGuard(db, relPath, data, mode, auditPath);
    const vaultPath = obsidian.obsidian_vault_path;
    const startTime = Date.now();

    // Collect all .md files
    const filePaths = await collectMdFiles(vaultPath, vaultPath);
    const seenPaths = new Set<string>(filePaths);

    // Get existing entries from DB for comparison
    const existing = new Map<string, { mtime: number; content_hash: string }>();
    const rows = db
      .select({
        path: vaultFiles.path,
        mtime: vaultFiles.mtime,
        content_hash: vaultFiles.content_hash,
      })
      .from(vaultFiles)
      .all();
    for (const row of rows) {
      existing.set(row.path, { mtime: row.mtime, content_hash: row.content_hash });
    }

    // Remove deleted files BEFORE upsert loop. Otherwise a moved file (oldPath →
    // newPath, same sparkle_id) hits a transient UNIQUE conflict on insert while
    // the old row is still present, falling back to sparkle_id=NULL permanently.
    const toDelete: string[] = [];
    for (const dbPath of existing.keys()) {
      if (!seenPaths.has(dbPath)) toDelete.push(dbPath);
    }
    let deleted = 0;
    if (toDelete.length > 0) {
      sqlite.transaction(() => {
        for (const dbPath of toDelete) {
          db.delete(vaultFiles).where(eq(vaultFiles.path, dbPath)).run();
          deleted++;
        }
      })();
    }

    let inserted = 0;
    let updated = 0;
    let errors = 0;

    for (const relPath of filePaths) {
      const fullPath = join(vaultPath, relPath);

      try {
        const fileStat = await stat(fullPath);
        const mtime = Math.floor(fileStat.mtimeMs);

        const dbEntry = existing.get(relPath);

        // Skip if mtime hasn't changed
        if (dbEntry && dbEntry.mtime === mtime) continue;

        // Read and process file
        const raw = await readFile(fullPath, "utf-8");
        const hash = contentHash(raw);

        // Skip if content hash matches (mtime changed but content same)
        if (dbEntry && dbEntry.content_hash === hash) {
          // Update mtime only
          db.update(vaultFiles).set({ mtime }).where(eq(vaultFiles.path, relPath)).run();
          continue;
        }

        const title = extractTitle(raw, relPath);
        const frontmatter = extractFrontmatterBlock(raw);
        const sparkleId = extractSparkleId(raw);

        const data = {
          title,
          frontmatter,
          content: raw,
          mtime,
          content_hash: hash,
          sparkle_id: sparkleId,
        };

        if (dbEntry) {
          upsert(relPath, data, "update");
          updated++;
        } else {
          upsert(relPath, data, "insert");
          inserted++;
        }
      } catch (e) {
        errors++;
        if (errors <= 5) {
          logger.warn(`vault-scanner: error reading ${relPath}: ${(e as Error).message}`);
        }
      }
    }

    const duration = Date.now() - startTime;
    if (duration > 10_000) {
      logger.warn(
        `vault-scanner: scan took ${(duration / 1000).toFixed(1)}s (${filePaths.length} files)`,
      );
    } else if (inserted > 0 || updated > 0 || deleted > 0) {
      logger.info(
        `vault-scanner: ${filePaths.length} files, ${inserted} new, ${updated} updated, ${deleted} deleted (${(duration / 1000).toFixed(1)}s)`,
      );
    }

    return { scanned: filePaths.length, inserted, updated, deleted, errors, skipped: false };
  } finally {
    scanInProgress = false;
  }
}

let vaultScanTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the vault scanner. Runs an initial scan then repeats every 5 minutes.
 */
export function startVaultScanner(db: DB, sqlite: Database.Database): void {
  // Run initial scan (fire and forget)
  scanVaultFiles(db, sqlite).catch((e) =>
    logger.warn(`vault-scanner: initial scan failed: ${(e as Error).message}`),
  );

  vaultScanTimer = setInterval(() => {
    scanVaultFiles(db, sqlite).catch((e) =>
      logger.warn(`vault-scanner: scan failed: ${(e as Error).message}`),
    );
  }, SCAN_INTERVAL_MS);

  vaultScanTimer.unref();
  logger.info("vault-scanner: started (5-min interval)");
}

/** Stop the vault scanner (for testing / shutdown). */
export function stopVaultScanner(): void {
  if (vaultScanTimer) {
    clearInterval(vaultScanTimer);
    vaultScanTimer = null;
  }
}
