// 30-day rename_history retention.
//
// Each title rename writes a rename_history audit row that supports the
// /admin/undo-rename/:id endpoint. Without cleanup the table grows forever
// (one row per title change). Operator-facing undo only matters for recent
// renames — anything older is git/backup territory. Drop rows older than
// 30 days on a daily-ish cadence so the table stays bounded.
//
// Wired into server/index.ts via setInterval; runs every 60s and short-circuits
// when the last cleanup is less than 24h ago (cheap timestamp check).

import type Database from "better-sqlite3";
import { logger } from "./logger.js";

const RETENTION_DAYS = 30;
const RUN_EVERY_MS = 24 * 60 * 60 * 1000; // 24h

let lastRunAt = 0;

/** Test-only reset; exported so tests can isolate the in-module timer. */
export function resetRenameHistoryCleanupForTest(): void {
  lastRunAt = 0;
}

/**
 * Delete rename_history rows older than `RETENTION_DAYS`. Idempotent +
 * cheap: a single DELETE with a WHERE on the indexed `performed_at` column.
 * Returns the number of deleted rows.
 */
export function pruneRenameHistory(sqlite: Database.Database, now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const result = sqlite.prepare("DELETE FROM rename_history WHERE performed_at < ?").run(cutoff);
  return result.changes;
}

/**
 * Tick called every 60s by the scheduler in server/index.ts. Runs the prune
 * once per 24h regardless of process restarts (in-memory throttle, so a
 * restart resets the timer — that's fine; the DELETE is idempotent).
 */
export function checkAndPruneRenameHistory(sqlite: Database.Database): void {
  const now = Date.now();
  if (now - lastRunAt < RUN_EVERY_MS) return;
  lastRunAt = now;

  try {
    const deleted = pruneRenameHistory(sqlite, new Date(now));
    if (deleted > 0) {
      logger.info(
        { event: "rename_history_pruned", deleted, retention_days: RETENTION_DAYS },
        `pruned ${deleted} rename_history row(s) older than ${RETENTION_DAYS}d`,
      );
    }
  } catch (err) {
    logger.error({ err, event: "rename_history_prune_failed" }, "rename_history prune failed");
  }
}
