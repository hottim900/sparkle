import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, basename, extname } from "node:path";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import * as schema from "../db/schema.js";
import { vaultFiles } from "../db/schema.js";
import { getObsidianSettings } from "./settings.js";
import { logger } from "./logger.js";

type DB = BetterSQLite3Database<typeof schema>;

const SCAN_INTERVAL_MS = 5 * 60_000; // 5 minutes

/**
 * Extract title from a markdown file. Uses first H1 heading, or filename.
 */
function extractTitle(content: string, filename: string): string {
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match?.[1]) return h1Match[1].trim();
  return basename(filename, extname(filename));
}

/**
 * Extract YAML frontmatter as a raw string (to be stored as JSON later).
 * Returns null if no frontmatter found.
 */
function extractFrontmatter(content: string): string | null {
  if (!content.startsWith("---\n")) return null;
  const endIdx = content.indexOf("\n---", 4);
  if (endIdx === -1) return null;
  return content.slice(4, endIdx);
}

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
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

/**
 * Full vault scan: index all .md files into vault_files table.
 * Uses content_hash to skip unchanged files. Removes deleted files from DB.
 */
export async function scanVaultFiles(
  db: DB,
  sqlite: Database.Database,
): Promise<{
  scanned: number;
  inserted: number;
  updated: number;
  deleted: number;
  errors: number;
}> {
  const obsidian = getObsidianSettings(sqlite);
  if (!obsidian.obsidian_enabled || !obsidian.obsidian_vault_path) {
    return { scanned: 0, inserted: 0, updated: 0, deleted: 0, errors: 0 };
  }

  const vaultPath = obsidian.obsidian_vault_path;
  const startTime = Date.now();

  // Collect all .md files
  const filePaths = await collectMdFiles(vaultPath, vaultPath);

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

  let inserted = 0;
  let updated = 0;
  let errors = 0;
  const seenPaths = new Set<string>();

  for (const relPath of filePaths) {
    seenPaths.add(relPath);
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
      const frontmatter = extractFrontmatter(raw);

      if (dbEntry) {
        // Update existing entry
        db.update(vaultFiles)
          .set({ title, frontmatter, content: raw, mtime, content_hash: hash })
          .where(eq(vaultFiles.path, relPath))
          .run();
        updated++;
      } else {
        // Insert new entry
        db.insert(vaultFiles)
          .values({ path: relPath, title, frontmatter, content: raw, mtime, content_hash: hash })
          .run();
        inserted++;
      }
    } catch (e) {
      errors++;
      if (errors <= 5) {
        logger.warn(`vault-scanner: error reading ${relPath}: ${(e as Error).message}`);
      }
    }
  }

  // Remove deleted files from DB
  let deleted = 0;
  for (const dbPath of existing.keys()) {
    if (!seenPaths.has(dbPath)) {
      db.delete(vaultFiles).where(eq(vaultFiles.path, dbPath)).run();
      deleted++;
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

  return { scanned: filePaths.length, inserted, updated, deleted, errors };
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
