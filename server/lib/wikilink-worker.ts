import type Database from "better-sqlite3";
import { drainReindexQueue } from "./wikilink.js";
import { logger } from "./logger.js";

/**
 * Background reindex worker — drains items_active.reindex_dirty=1 in batches
 * every 60s. Pairs with createItem/updateItem/import write hooks that mark
 * dirty=1 after content or title changes.
 *
 * Per-cycle batch is capped at 50 rows so a backlog (e.g. after a bulk import
 * or the post-migration mark-all-dirty) doesn't block the cycle; the next
 * tick picks up the remainder. ceil(N / 50) minutes to drain N rows, which
 * is acceptable because the renderer queries the resolver directly — unindexed
 * links still render correctly. The index exists for the rename engine's
 * reverse-lookup (PR 3), not for live render.
 *
 * Reentrancy guard: `running` ensures a slow cycle (large content reindexes
 * hitting many wikilinks) doesn't overlap with the next tick. Skipped ticks
 * are logged so an operator can spot a worker that's chronically behind.
 */

let running = false;
let skipped = 0;
const BATCH_LIMIT = 50;

export function checkAndDrainReindexQueue(sqlite: Database.Database): void {
  if (running) {
    skipped++;
    if (skipped % 10 === 0) {
      logger.warn({ skipped }, "wikilink worker tick skipped — previous cycle still running");
    }
    return;
  }
  running = true;
  // Reset on successful entry so a transient overlap window doesn't poison
  // the warning cadence for the rest of the process lifetime.
  skipped = 0;
  try {
    const count = drainReindexQueue(sqlite, BATCH_LIMIT);
    if (count > 0) {
      logger.debug({ event: "wikilink_reindex_batch", count }, `reindexed ${count} items`);
    }
  } catch (err) {
    logger.error({ err }, "wikilink reindex batch failed");
  } finally {
    running = false;
  }
}
