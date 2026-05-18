// Title rename propagation engine.
//
// When an items_active row's title changes, every source that cites it via
// `[[Old Title]]` should be rewritten to `[[New Title]]`. Reading from
// reference_index (the reverse-lookup built by the wikilink worker in PR 1),
// the engine identifies every source, computes the rewritten content, and
// applies the UPDATEs in a single transaction.
//
// Engine writes are content rewrites — they go through the same write path
// as user edits, which means they re-mark `reindex_dirty=1` and re-key the
// references on the next worker cycle (PR 1 hook).
//
// All renames are recorded in `rename_history` for audit + undo. Undo
// replays the inverse rewrite using the audit row's old_title.
//
// Spec: docs/wikilink-spec.md (Pre-PR0d/e). Out of scope for PR 3:
// vault `.md` rewrites (Pre-PR0d active-only carve-out).

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { parseWikilinks } from "../../src/lib/wikilink.js";
import { logger } from "./logger.js";

export interface RenameResult {
  /** Number of source items whose content was rewritten. */
  rewrittenCount: number;
  /** Source ids that were rewritten (UUID). */
  rewrittenSourceIds: string[];
  /** Audit row id (rename_history.id) — empty when noop. */
  historyId: string | null;
  /**
   * Source ids that were SKIPPED to avoid the ENG-3 share-token leak: the
   * target is private AND the source has an active share_token row. Skipping
   * preserves the source's old `[[Title]]` text so a public viewer doesn't
   * see the renamed (still-private) title. Worker re-derives reference_index
   * on the next cycle; the source's reference becomes unresolved (purple
   * renderer state) until the user removes or updates the reference.
   */
  skippedShareTokenSourceIds: string[];
}

interface RewritePlan {
  sourceId: string;
  oldContent: string;
  newContent: string;
}

/**
 * Apply a title rename to every source that cites this target. Called from
 * `updateItem` (server/lib/items.ts) when `input.title !== existing.title`.
 *
 * `oldTitle` and `newTitle` are passed in already trimmed; this function
 * does not re-normalize. Empty `oldTitle` (target had no title before, e.g.
 * a newly-created note's first title set) is a no-op — there's nothing to
 * rewrite from.
 *
 * The sweep:
 *   1. SELECT reference_index rows where target_id = id (the target).
 *   2. GROUP by source_id; for each source, fetch content, parse wikilinks,
 *      rewrite every `[[oldTitle]]` to `[[newTitle]]` preserving alias if
 *      present (alias is the user-chosen display label — it survives rename).
 *   3. UPDATE the source rows in a single transaction; each UPDATE marks the
 *      source `reindex_dirty=1` so the worker re-derives the reference rows.
 *   4. Append a rename_history row with the count and the source-id list.
 *
 * The engine does NOT touch:
 *   - items_vault content (vault is SSOT post-v25; Pre-PR0d carve-out).
 *   - Daily-note .md files (Pre-PR0d).
 *   - Legacy `筆記（xxxx）` references (those target by id not by title, so
 *     a title rename doesn't affect their resolution).
 *
 * Returns the rewrite count + the history id so the caller can return
 * `swept_references` in its response (PR 2 contract).
 */
export function applyTitleRename(
  sqlite: Database.Database,
  targetId: string,
  oldTitle: string,
  newTitle: string,
  performedBy: string = "system",
): RenameResult {
  if (oldTitle === newTitle || oldTitle.trim() === "") {
    return {
      rewrittenCount: 0,
      rewrittenSourceIds: [],
      historyId: null,
      skippedShareTokenSourceIds: [],
    };
  }

  // Pull every source that the index says cites this target via a wikilink
  // (not legacy_hex — legacy targets by id, not title, so a rename is moot).
  let sourceIds = sqlite
    .prepare(
      `SELECT DISTINCT source_id FROM reference_index
       WHERE target_id = ? AND kind = 'wikilink'`,
    )
    .all(targetId) as { source_id: string }[];

  if (sourceIds.length === 0) {
    return {
      rewrittenCount: 0,
      rewrittenSourceIds: [],
      historyId: null,
      skippedShareTokenSourceIds: [],
    };
  }

  // ENG-3: share_token leak guard. If the target is private, the rename
  // would expose the new (still-private) title in any source that has an
  // active share_token — the public viewer of the share page would see
  // `[[New Private Title]]` rendered as literal text. Skip those sources.
  // We still rewrite sources without share_tokens — those are not publicly
  // visible, so the rewrite is safe.
  const target = sqlite
    .prepare("SELECT is_private FROM items_active WHERE id = ?")
    .get(targetId) as { is_private: number } | undefined;
  const skippedShareTokenSourceIds: string[] = [];
  if (target?.is_private === 1) {
    const ids = sourceIds.map((s) => s.source_id);
    const placeholders = ids.map(() => "?").join(",");
    const sharedRows = sqlite
      .prepare(`SELECT DISTINCT item_id FROM share_tokens WHERE item_id IN (${placeholders})`)
      .all(...ids) as { item_id: string }[];
    if (sharedRows.length > 0) {
      const sharedSet = new Set(sharedRows.map((r) => r.item_id));
      for (const id of ids) {
        if (sharedSet.has(id)) skippedShareTokenSourceIds.push(id);
      }
      sourceIds = sourceIds.filter((s) => !sharedSet.has(s.source_id));
      logger.warn(
        {
          event: "rename_share_token_skip",
          target_id: targetId,
          skipped_source_count: skippedShareTokenSourceIds.length,
        },
        `rename of private item skipped ${skippedShareTokenSourceIds.length} shared source(s) to avoid title leak`,
      );
    }
  }

  const plans: RewritePlan[] = [];
  for (const { source_id } of sourceIds) {
    const row = sqlite.prepare("SELECT content FROM items_active WHERE id = ?").get(source_id) as
      | { content: string | null }
      | undefined;
    if (!row) continue;
    const oldContent = row.content ?? "";
    const newContent = rewriteWikilinks(oldContent, oldTitle, newTitle);
    if (newContent !== oldContent) {
      plans.push({ sourceId: source_id, oldContent, newContent });
    }
  }

  if (plans.length === 0) {
    // Index claimed these sources cite the target, but the content scan didn't
    // find any matching wikilink. This happens when the index is stale (worker
    // hasn't drained a recent edit that removed the ref). Skip silently —
    // worker will re-derive shortly.
    return {
      rewrittenCount: 0,
      rewrittenSourceIds: [],
      historyId: null,
      skippedShareTokenSourceIds,
    };
  }

  const historyId = randomUUID();
  const now = new Date().toISOString();
  const sourceIdList = plans.map((p) => p.sourceId);

  const tx = sqlite.transaction(() => {
    const upd = sqlite.prepare(
      "UPDATE items_active SET content = ?, reindex_dirty = 1, modified = ? WHERE id = ?",
    );
    for (const plan of plans) {
      upd.run(plan.newContent, now, plan.sourceId);
    }

    sqlite
      .prepare(
        `INSERT INTO rename_history
           (id, target_id, old_title, new_title, source_count, performed_at, performed_by, undo_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        historyId,
        targetId,
        oldTitle,
        newTitle,
        plans.length,
        now,
        performedBy,
        JSON.stringify({ sources: sourceIdList }),
      );
  });
  tx();

  logger.info(
    {
      event: "rename_applied",
      target_id: targetId,
      old_title: oldTitle,
      new_title: newTitle,
      source_count: plans.length,
      performed_by: performedBy,
    },
    `rename ${oldTitle} → ${newTitle} rewrote ${plans.length} sources`,
  );

  return {
    rewrittenCount: plans.length,
    rewrittenSourceIds: sourceIdList,
    historyId,
    skippedShareTokenSourceIds,
  };
}

/**
 * Rewrite every `[[oldTitle]]` (and `[[oldTitle|alias]]`) in content to
 * `[[newTitle]]` / `[[newTitle|alias]]`. The shared parser supplies positions
 * + alias detection so we don't have to re-derive boundaries with regex.
 *
 * Replacements applied in descending offset order so earlier offsets stay
 * valid (ENG-20).
 */
export function rewriteWikilinks(content: string, oldTitle: string, newTitle: string): string {
  const refs = parseWikilinks(content);
  if (refs.length === 0) return content;

  let result = content;
  // Iterate in descending offset order so the in-flight `result` slice
  // boundaries for earlier matches still match what the parser saw.
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i]!;
    if (ref.title !== oldTitle) continue;
    const inner = ref.alias === null ? newTitle : `${newTitle}|${ref.alias}`;
    const replacement = `[[${inner}]]`;
    result = result.slice(0, ref.start) + replacement + result.slice(ref.start + ref.length);
  }
  return result;
}

export interface UndoResult {
  /** Number of source items whose content was rewritten back. */
  rewrittenCount: number;
  /** Source ids that were rewritten. */
  rewrittenSourceIds: string[];
}

/**
 * Undo a recorded rename. Reads the audit row, swaps old↔new titles, and
 * applies the inverse rewrite. Records a new rename_history row so the
 * undo itself is auditable (performed_by suffix = "undo:" + originalId).
 *
 * Returns null when the history row doesn't exist.
 */
export function undoRename(sqlite: Database.Database, historyId: string): UndoResult | null {
  const row = sqlite
    .prepare(`SELECT target_id, old_title, new_title FROM rename_history WHERE id = ?`)
    .get(historyId) as { target_id: string; old_title: string; new_title: string } | undefined;
  if (!row) return null;

  // Set the target's title back FIRST so subsequent reads see the inverse.
  // This MUST happen even when there are no remaining sources, because the
  // user's intent is "make this rename go away" — including the title flip.
  sqlite
    .prepare("UPDATE items_active SET title = ?, modified = ? WHERE id = ?")
    .run(row.old_title, new Date().toISOString(), row.target_id);

  // Now sweep — the engine will rewrite [[new_title]] → [[old_title]] in any
  // source that still cites the post-rename title.
  const inverse = applyTitleRename(
    sqlite,
    row.target_id,
    row.new_title,
    row.old_title,
    `undo:${historyId}`,
  );

  return {
    rewrittenCount: inverse.rewrittenCount,
    rewrittenSourceIds: inverse.rewrittenSourceIds,
  };
}
