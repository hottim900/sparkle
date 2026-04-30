import { stat } from "node:fs/promises";
import { join } from "node:path";
import { eq, isNotNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import * as schema from "../db/schema.js";
import { itemsVault, vaultFiles } from "../db/schema.js";

type DB = BetterSQLite3Database<typeof schema>;
import { getObsidianSettings } from "./settings.js";
import { logger } from "./logger.js";

const SCAN_INTERVAL_MS = 60_000;

/**
 * 2-scan debounce (D10 / Round 3 item 11): suppress the first ENOENT as a
 * transient boot-window miss (vault mount race on NFS/external drives). Only
 * on the SECOND consecutive miss do we run the sparkle_id lookup + UPDATE +
 * WARN log. Avoids a log-storm if the vault is briefly unmounted at boot.
 *
 * Process-lifetime map: id → consecutive miss count. Cleared when the miss
 * eventually resolves (file found) or when self-heal fires.
 */
const missCountMap = new Map<string, number>();

/**
 * Single scan pass: check all items_vault rows with export_path. If a file is
 * missing we try to self-heal via vault_files.sparkle_id. Content sync has been
 * removed in v1.4.0 — vault is the source of truth for exported content, so we
 * do not round-trip edits from .md files back into Sparkle's DB.
 */
export async function scanExportedItems(
  db: DB,
  sqlite: Database.Database,
): Promise<{ scanned: number; patched: number; errors: number }> {
  const obsidian = getObsidianSettings(sqlite);
  if (!obsidian.obsidian_enabled || !obsidian.obsidian_vault_path) {
    return { scanned: 0, patched: 0, errors: 0 };
  }

  const vaultPath = obsidian.obsidian_vault_path;

  const exported = db
    .select({
      id: itemsVault.id,
      export_path: itemsVault.export_path,
    })
    .from(itemsVault)
    .where(isNotNull(itemsVault.export_path))
    .all();

  let patched = 0;
  let errors = 0;

  for (const item of exported) {
    if (!item.export_path) continue;
    const fullPath = join(vaultPath, item.export_path);

    try {
      await stat(fullPath);
      // File exists — clear any accumulated miss count.
      missCountMap.delete(item.id);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        errors++;
        logger.warn(`vault-watcher: error stat'ing ${item.export_path}: ${(e as Error).message}`);
        continue;
      }

      const count = (missCountMap.get(item.id) ?? 0) + 1;
      missCountMap.set(item.id, count);
      if (count < 2) {
        logger.debug(
          { id: item.id, path: item.export_path },
          `vault-watcher: export_path missing (miss ${count}/2)`,
        );
        continue;
      }

      // Second consecutive miss — attempt self-heal via sparkle_id reverse-lookup.
      // Self-heal stays in place during the PR 2 dual-write window. PR 3 deletes
      // this entire watcher (vault_files reverse-lookup is the primary path).
      missCountMap.delete(item.id);
      const row = db
        .select({ path: vaultFiles.path })
        .from(vaultFiles)
        .where(eq(vaultFiles.sparkle_id, item.id))
        .get();
      if (row) {
        db.update(itemsVault)
          .set({ export_path: row.path })
          .where(eq(itemsVault.id, item.id))
          .run();
        patched++;
        logger.warn(
          `vault-watcher: self-healed ${item.export_path} → ${row.path} for item ${item.id}`,
        );
      } else {
        // PR 2: surface orphans as structured logs so journalctl-grep gates
        // (PR 3 prerequisite) catch new orphans introduced post-deploy.
        logger.warn(
          {
            event: "vault_orphan_detected",
            item_id: item.id,
            last_known_path: item.export_path,
          },
          `vault-watcher: export_path ${item.export_path} missing and no vault_files match for item ${item.id}`,
        );
      }
    }
  }

  return { scanned: exported.length, patched, errors };
}

/** Clear debounce state (for testing). */
export function clearMissCountCache(): void {
  missCountMap.clear();
}

let scanTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the vault watcher. Runs an initial scan then repeats every 60s.
 * Safe to call when Obsidian is not configured — will no-op.
 */
export function startVaultWatcher(db: DB, sqlite: Database.Database): void {
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
