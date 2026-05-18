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
import { createHash, randomUUID } from "node:crypto";
import { parseWikilinks } from "../../src/lib/wikilink.js";
import { logger } from "./logger.js";

/**
 * Thrown by `applyTitleRename` when the caller passed an `expectedStateHash`
 * that no longer matches the live state — i.e. between preview and commit,
 * the target was renamed by someone else, sources were added/removed, or a
 * source's content was edited in a way that would change what we'd rewrite.
 *
 * Route layer maps this to 409 STATE_CHANGED so the agent can re-preview.
 */
export class RenameStateChangedError extends Error {
  readonly code = "RENAME_STATE_CHANGED" as const;
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `Rename state changed since preview — expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…`,
    );
    this.name = "RenameStateChangedError";
  }
}

/**
 * Fingerprint the inputs `applyTitleRename` will read from the database, so a
 * preview/commit pair can detect any racing write that would change the
 * rewrite scope.
 *
 * Includes: target id, the title we expect to rename FROM (catches a racing
 * title flip), and for each source — its id + sha256 of its content (catches
 * a racing edit that adds or removes a `[[Title]]` reference).
 *
 * Source-id ordering is stable (SQL ORDER BY) so the hash is deterministic.
 *
 * Stateless: no row inserted server-side; caller passes the hash back in the
 * subsequent commit and the server recomputes + compares. This is the
 * "good-enough" race guard from docs/wikilink-spec.md DX-2 — it doesn't pin
 * the underlying rows, just rejects commits that would operate on a different
 * snapshot than the user reviewed.
 */
export function computeRenameStateHash(
  sqlite: Database.Database,
  targetId: string,
  oldTitle: string,
): string {
  const sourceIds = sqlite
    .prepare(
      `SELECT DISTINCT source_id FROM reference_index
       WHERE target_id = ? AND kind = 'wikilink'
       ORDER BY source_id`,
    )
    .all(targetId) as { source_id: string }[];

  const hash = createHash("sha256");
  hash.update(`t:${targetId}\no:${oldTitle}\n`);
  for (const { source_id } of sourceIds) {
    const row = sqlite.prepare("SELECT content FROM items_active WHERE id = ?").get(source_id) as
      | { content: string | null }
      | undefined;
    const content = row?.content ?? "";
    const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    hash.update(`s:${source_id}:${contentHash}\n`);
  }
  return hash.digest("hex");
}

export interface RenameResult {
  /** Number of source items whose content was rewritten. */
  rewrittenCount: number;
  /** Source ids that were rewritten (UUID). */
  rewrittenSourceIds: string[];
  /**
   * Source id + title for each rewritten row — the frontend rename dialog
   * (DES-5) needs the titles inline to render a "what just changed" list
   * without N extra fetches. Title is captured at rewrite time, so the
   * dialog shows what the row WAS called, not whatever it might be renamed
   * to a moment later.
   */
  rewrittenSources: Array<{ id: string; title: string }>;
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
  sourceTitle: string;
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
  expectedStateHash?: string,
): RenameResult {
  if (oldTitle === newTitle || oldTitle.trim() === "") {
    return {
      rewrittenCount: 0,
      rewrittenSourceIds: [],
      rewrittenSources: [],
      historyId: null,
      skippedShareTokenSourceIds: [],
    };
  }

  // DX-2 race guard: when the caller supplied a hash from `previewTitleRename`,
  // recompute it now (inside the BEGIN IMMEDIATE owned by the route layer) and
  // bail if it changed. This catches a racing edit between preview and commit.
  if (expectedStateHash !== undefined) {
    const actual = computeRenameStateHash(sqlite, targetId, oldTitle);
    if (actual !== expectedStateHash) {
      throw new RenameStateChangedError(expectedStateHash, actual);
    }
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
      rewrittenSources: [],
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
    const row = sqlite
      .prepare("SELECT title, content FROM items_active WHERE id = ?")
      .get(source_id) as { title: string; content: string | null } | undefined;
    if (!row) continue;
    const oldContent = row.content ?? "";
    const newContent = rewriteWikilinks(oldContent, oldTitle, newTitle);
    if (newContent !== oldContent) {
      plans.push({ sourceId: source_id, sourceTitle: row.title, oldContent, newContent });
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
      rewrittenSources: [],
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
    rewrittenSources: plans.map((p) => ({ id: p.sourceId, title: p.sourceTitle })),
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

export interface PreviewResult {
  /** Number of sources that WOULD be rewritten if applyTitleRename ran. */
  wouldRewriteCount: number;
  /** Source ids that would be rewritten. */
  wouldRewriteSourceIds: string[];
  /** Source ids that would be skipped by the ENG-3 share-token guard. */
  wouldSkipShareTokenSourceIds: string[];
  /**
   * Sample of source previews for the operator/agent to review. Capped at
   * 5 entries — callers that need the full list use `wouldRewriteSourceIds`
   * + `sparkle_get_note` per id.
   */
  preview: Array<{ source_id: string; source_title: string; snippet: string }>;
  /**
   * Fingerprint of the state this preview was computed against (DX-2). Pass
   * to `applyTitleRename` (via PATCH body `expected_state_hash`) to reject
   * commits that landed after a racing edit.
   */
  stateHash: string;
}

/**
 * Dry-run companion to `applyTitleRename` (DX-2 / dry-run protocol). Reads
 * the same `reference_index` and applies the same share-token leak guard
 * but does NOT write — returns the predicted impact so an MCP agent (or the
 * frontend rename dialog) can preview before committing.
 *
 * Stateless: no token, no in-flight pending operation. Agents call
 * `applyTitleRename` (via `PATCH /api/items/:id`) when they've reviewed.
 */
export function previewTitleRename(
  sqlite: Database.Database,
  targetId: string,
  oldTitle: string,
  newTitle: string,
): PreviewResult {
  if (oldTitle === newTitle || oldTitle.trim() === "") {
    return {
      wouldRewriteCount: 0,
      wouldRewriteSourceIds: [],
      wouldSkipShareTokenSourceIds: [],
      preview: [],
      stateHash: computeRenameStateHash(sqlite, targetId, oldTitle),
    };
  }

  let sourceIds = sqlite
    .prepare(
      `SELECT DISTINCT source_id FROM reference_index
       WHERE target_id = ? AND kind = 'wikilink'`,
    )
    .all(targetId) as { source_id: string }[];

  if (sourceIds.length === 0) {
    return {
      wouldRewriteCount: 0,
      wouldRewriteSourceIds: [],
      wouldSkipShareTokenSourceIds: [],
      preview: [],
      stateHash: computeRenameStateHash(sqlite, targetId, oldTitle),
    };
  }

  const target = sqlite
    .prepare("SELECT is_private FROM items_active WHERE id = ?")
    .get(targetId) as { is_private: number } | undefined;
  const wouldSkipShareTokenSourceIds: string[] = [];
  if (target?.is_private === 1) {
    const ids = sourceIds.map((s) => s.source_id);
    const placeholders = ids.map(() => "?").join(",");
    const sharedRows = sqlite
      .prepare(`SELECT DISTINCT item_id FROM share_tokens WHERE item_id IN (${placeholders})`)
      .all(...ids) as { item_id: string }[];
    if (sharedRows.length > 0) {
      const sharedSet = new Set(sharedRows.map((r) => r.item_id));
      for (const id of ids) {
        if (sharedSet.has(id)) wouldSkipShareTokenSourceIds.push(id);
      }
      sourceIds = sourceIds.filter((s) => !sharedSet.has(s.source_id));
    }
  }

  const wouldRewriteSourceIds: string[] = [];
  const preview: PreviewResult["preview"] = [];
  for (const { source_id } of sourceIds) {
    const row = sqlite
      .prepare("SELECT title, content FROM items_active WHERE id = ?")
      .get(source_id) as { title: string; content: string | null } | undefined;
    if (!row) continue;
    const oldContent = row.content ?? "";
    const newContent = rewriteWikilinks(oldContent, oldTitle, newTitle);
    if (newContent === oldContent) continue;
    wouldRewriteSourceIds.push(source_id);
    if (preview.length < 5) {
      // Build a short snippet centered on the first wikilink occurrence.
      const idx = oldContent.indexOf(`[[${oldTitle}`);
      const start = Math.max(0, idx - 30);
      const end = Math.min(oldContent.length, idx + 50);
      preview.push({
        source_id,
        source_title: row.title,
        snippet:
          (start > 0 ? "…" : "") +
          oldContent.slice(start, end) +
          (end < oldContent.length ? "…" : ""),
      });
    }
  }

  return {
    wouldRewriteCount: wouldRewriteSourceIds.length,
    wouldRewriteSourceIds,
    wouldSkipShareTokenSourceIds,
    preview,
    stateHash: computeRenameStateHash(sqlite, targetId, oldTitle),
  };
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
