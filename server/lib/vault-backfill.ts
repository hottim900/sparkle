import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import * as schema from "../db/schema.js";
import { items } from "../db/schema.js";
import { getObsidianSettings } from "./settings.js";
import { logger } from "./logger.js";

type DB = BetterSQLite3Database<typeof schema>;

/**
 * Extract sparkle_id from YAML frontmatter in a markdown file.
 * Returns null if no valid frontmatter or sparkle_id found.
 */
export function extractSparkleId(content: string): string | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch?.[1]) return null;
  const idMatch = fmMatch[1].match(/^sparkle_id:\s*"?([^"\n]+)"?/m);
  return idMatch?.[1] ?? null;
}

/**
 * Backfill export_path for items that were exported before the column existed.
 * Scans the Obsidian inbox folder for .md files with sparkle_id frontmatter,
 * matches them to DB items where export_path IS NULL and status = 'exported',
 * then writes the vault-relative path.
 *
 * Idempotent: safe to run on every server start. Skips items that already have
 * export_path set.
 */
export async function backfillExportPaths(
  db: DB,
  sqlite: Database.Database,
): Promise<{ matched: number; scanned: number }> {
  const obsidian = getObsidianSettings(sqlite);
  if (!obsidian.obsidian_enabled || !obsidian.obsidian_vault_path) {
    return { matched: 0, scanned: 0 };
  }

  const vaultPath = obsidian.obsidian_vault_path;
  const inboxFolder = obsidian.obsidian_inbox_folder;
  const targetDir = join(vaultPath, inboxFolder);

  // Get exported items missing export_path (only exported status)
  const needsBackfill = db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.status, "exported"), isNull(items.export_path)))
    .all()
    .reduce((set, row) => {
      set.add(row.id);
      return set;
    }, new Set<string>());

  if (needsBackfill.size === 0) {
    return { matched: 0, scanned: 0 };
  }

  let files: string[];
  try {
    files = await readdir(targetDir);
  } catch {
    // Directory doesn't exist or is inaccessible
    return { matched: 0, scanned: 0 };
  }

  let matched = 0;
  let scanned = 0;

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    scanned++;

    try {
      const content = await readFile(join(targetDir, file), "utf-8");
      const sparkleId = extractSparkleId(content);
      if (!sparkleId || !needsBackfill.has(sparkleId)) continue;

      const exportPath = `${inboxFolder}/${file}`;
      db.update(items).set({ export_path: exportPath }).where(eq(items.id, sparkleId)).run();

      matched++;
      needsBackfill.delete(sparkleId);
      logger.info(`vault-backfill: matched ${file} → item ${sparkleId}`);
    } catch (e) {
      logger.warn(`vault-backfill: error reading ${file}: ${(e as Error).message}`);
    }
  }

  if (matched > 0) {
    logger.info(`vault-backfill: matched ${matched} of ${scanned} files`);
  }

  return { matched, scanned };
}
