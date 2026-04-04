import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import * as schema from "../db/schema.js";
import { items } from "../db/schema.js";

type DB = BetterSQLite3Database<typeof schema>;
import { getObsidianSettings } from "./settings.js";
import { logger } from "./logger.js";

const SCAN_INTERVAL_MS = 60_000;

/** Track last-seen mtime per export_path to avoid re-reading unchanged files */
const mtimeCache = new Map<string, number>();

/**
 * Extract body content from a markdown file, stripping YAML frontmatter.
 */
export function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---\n")) return raw;
  const endIdx = raw.indexOf("\n---", 4);
  if (endIdx === -1) return raw;
  return raw.slice(endIdx + 4).replace(/^\n+/, "");
}

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Single scan pass: check all items with export_path for vault-side edits.
 * Updates items.content when file content differs (by hash).
 * Does NOT update items.modified — this is a sync, not a user edit.
 */
export async function scanExportedItems(
  db: DB,
  sqlite: Database.Database,
): Promise<{ scanned: number; updated: number; errors: number }> {
  const obsidian = getObsidianSettings(sqlite);
  if (!obsidian.obsidian_enabled || !obsidian.obsidian_vault_path) {
    return { scanned: 0, updated: 0, errors: 0 };
  }

  const vaultPath = obsidian.obsidian_vault_path;

  // Get exported items with an export_path (only sync items still in exported status)
  const exported = db
    .select({
      id: items.id,
      export_path: items.export_path,
      content: items.content,
    })
    .from(items)
    .where(and(eq(items.status, "exported"), isNotNull(items.export_path)))
    .all();

  let updated = 0;
  let errors = 0;

  for (const item of exported) {
    if (!item.export_path) continue;

    const fullPath = join(vaultPath, item.export_path);

    try {
      const fileStat = await stat(fullPath);
      const mtime = fileStat.mtimeMs;

      // Skip if mtime hasn't changed since last scan
      const cachedMtime = mtimeCache.get(item.export_path);
      if (cachedMtime !== undefined && cachedMtime === mtime) {
        continue;
      }

      // mtime changed (or first scan) — read and compare content
      const raw = await readFile(fullPath, "utf-8");
      const body = stripFrontmatter(raw);
      const fileHash = contentHash(body);
      const dbHash = contentHash(item.content || "");

      // Update mtime cache regardless of content match
      mtimeCache.set(item.export_path, mtime);

      if (fileHash !== dbHash) {
        db.update(items).set({ content: body }).where(eq(items.id, item.id)).run();
        updated++;
        logger.info(`vault-watcher: synced ${item.export_path} → item ${item.id}`);
      }
    } catch (e) {
      const msg = (e as NodeJS.ErrnoException).code;
      if (msg === "ENOENT") {
        // File deleted from vault — clear mtime cache, don't touch DB
        mtimeCache.delete(item.export_path);
      } else {
        errors++;
        logger.warn(`vault-watcher: error reading ${item.export_path}: ${(e as Error).message}`);
      }
    }
  }

  return { scanned: exported.length, updated, errors };
}

/** Clear the mtime cache (for testing). */
export function clearMtimeCache(): void {
  mtimeCache.clear();
}

let scanTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the vault watcher. Runs an initial scan then repeats every 60s.
 * Safe to call when Obsidian is not configured — will no-op.
 */
export function startVaultWatcher(db: DB, sqlite: Database.Database): void {
  // Run initial scan (fire and forget)
  scanExportedItems(db, sqlite).catch((e) =>
    logger.warn(`vault-watcher: initial scan failed: ${(e as Error).message}`),
  );

  scanTimer = setInterval(() => {
    scanExportedItems(db, sqlite).catch((e) =>
      logger.warn(`vault-watcher: scan failed: ${(e as Error).message}`),
    );
  }, SCAN_INTERVAL_MS);

  scanTimer.unref();
  logger.info("vault-watcher: started (60s interval)");
}

/** Stop the vault watcher (for testing / shutdown). */
export function stopVaultWatcher(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}
