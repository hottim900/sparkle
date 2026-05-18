import { Hono } from "hono";
import { sqlite } from "../db/index.js";
import { resolveWikilinkTitle } from "../lib/wikilink.js";
import { normalizeTitleForUniqueness, isTitleInAllowlist } from "../../src/lib/wikilink.js";
import { undoRename, previewTitleRename } from "../lib/rename-engine.js";
import { logger } from "../lib/logger.js";

const wikilinksRouter = new Hono();

/**
 * Resolve a wikilink title to an item id + preview snippet. Frontend
 * renderer (src/components/wikilink-text.tsx) calls this per unique title;
 * React Query caches the result.
 *
 * Response shapes:
 *   { id, title, origin: "active" | "vault", snippet }  — single match
 *   { error: "NOT_FOUND" }                              — no match
 *   { error: "COLLISION" }                              — multiple matches
 *   { error: "EMPTY_TITLE" }                            — missing/blank query
 *
 * Snippet is the first 200 code points of content (active) or
 * content_snippet column (vault). Used by the hover card preview.
 */
wikilinksRouter.get("/resolve", (c) => {
  const rawTitle = c.req.query("title") ?? "";
  if (rawTitle.trim() === "") {
    return c.json({ error: "EMPTY_TITLE" as const }, 400);
  }

  const resolved = resolveWikilinkTitle(sqlite, rawTitle);
  if (!resolved) {
    // The resolver returns null for both miss and collision; the renderer
    // treats them the same (unresolved purple), so we don't disambiguate
    // here. If a future caller needs to distinguish, expose a flag.
    return c.json({ error: "NOT_FOUND" as const }, 404);
  }

  // Push truncation into SQLite so a multi-MB content blob isn't shipped to
  // userland just to slice it down to ~200 chars. 800 chars is a generous
  // upper bound for the 200-codepoint UTF-16 slice that follows — multi-byte
  // chars (CJK) take 3-4 bytes each, ASCII takes 1, so 800 covers all cases.
  let snippet = "";
  if (resolved.origin === "active") {
    const row = sqlite
      .prepare("SELECT SUBSTR(content, 1, 800) AS body FROM items_active WHERE id = ?")
      .get(resolved.id) as { body: string | null } | undefined;
    snippet = sliceSnippet(row?.body ?? "");
  } else {
    const row = sqlite
      .prepare("SELECT content_snippet FROM items_vault WHERE id = ?")
      .get(resolved.id) as { content_snippet: string } | undefined;
    snippet = sliceSnippet(row?.content_snippet ?? "");
  }

  return c.json({
    id: resolved.id,
    title: resolved.title,
    origin: resolved.origin,
    snippet,
  });
});

/**
 * Admin disaster-recovery endpoint: TRUNCATE reference_index + mark every
 * items_active row dirty so the worker rebuilds the index from scratch.
 *
 * Guarded by the global /api/* auth middleware (Bearer AUTH_TOKEN). The
 * actual rebuild happens asynchronously over the next few worker cycles;
 * this endpoint returns 202 once the queue is primed.
 *
 * Use when: index has drifted (manual SQL edits to items_active.content
 * outside the chokepoint), schema migration left orphans, or a bug in the
 * parser was fixed and the index needs to reflect the corrected parse.
 *
 * Race window: between this commit and the worker's next drain, other
 * readers (PR 3's rename engine via reverse-lookup) see an empty index.
 * The renderer is unaffected — it queries the resolver directly. PR 3's
 * rename engine should grab a rename lock that holds out the admin rebuild
 * surface; tracked separately.
 */
wikilinksRouter.post("/admin/rebuild", (c) => {
  const tx = sqlite.transaction(() => {
    sqlite.exec("DELETE FROM reference_index");
    sqlite.exec("UPDATE items_active SET reindex_dirty = 1");
  });
  try {
    tx();
  } catch (err) {
    logger.error({ err }, "wikilink admin rebuild failed");
    return c.json({ error: "REBUILD_FAILED" }, 500);
  }

  const queued = (sqlite.prepare("SELECT COUNT(*) AS n FROM items_active").get() as { n: number })
    .n;
  logger.info({ event: "wikilink_admin_rebuild", queued }, `queued ${queued} items for reindex`);
  return c.json({ status: "queued", queued }, 202);
});

function sliceSnippet(content: string): string {
  const chars = [...content.replace(/\s+/g, " ").trim()];
  return chars.length > 200 ? chars.slice(0, 200).join("") + "…" : chars.join("");
}

/**
 * Recent renames listing (admin). Lists the most recent N entries from
 * rename_history for the operator UI. Read-only; auth via /api/* middleware.
 */
wikilinksRouter.get("/admin/recent-renames", (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const rows = sqlite
    .prepare(
      `SELECT id, target_id, old_title, new_title, source_count, performed_at, performed_by
       FROM rename_history
       ORDER BY performed_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    target_id: string;
    old_title: string;
    new_title: string;
    source_count: number;
    performed_at: string;
    performed_by: string;
  }>;
  return c.json({ renames: rows });
});

/**
 * Undo a rename by audit row id. Replays the inverse rewrite: target title
 * goes back to old_title, every source still citing new_title gets rewritten
 * to old_title. A NEW rename_history row is appended for the undo itself
 * (performed_by = "undo:<originalId>") so the audit log is append-only.
 *
 * 404 when historyId doesn't exist. Returns counts so the operator UI can
 * confirm what flipped.
 */
wikilinksRouter.post("/admin/undo-rename/:historyId", (c) => {
  const historyId = c.req.param("historyId");
  const result = undoRename(sqlite, historyId);
  if (!result) {
    return c.json({ error: "RENAME_NOT_FOUND", historyId }, 404);
  }
  logger.info(
    {
      event: "rename_undone",
      historyId,
      rewrittenCount: result.rewrittenCount,
    },
    `undo of rename ${historyId} rewrote ${result.rewrittenCount} sources`,
  );
  return c.json({
    status: "undone",
    historyId,
    rewrittenCount: result.rewrittenCount,
    rewrittenSourceIds: result.rewrittenSourceIds,
  });
});

/**
 * Title-collision listing (admin). Returns groups of items_active rows that
 * share a normalized title — these are pre-Pre-PR0e duplicates that slipped
 * in before write-time uniqueness enforcement (PR 5). New writes are blocked
 * by `isTitleAvailable`; this endpoint surfaces the legacy duplicates so the
 * operator can rename or merge them.
 *
 * Allowlist titles (`未命名`) are excluded — duplicate placeholders are legal.
 *
 * Response: `{ collisions: [{ normalized, rows: [{ id, title, type, status, modified }] }], total }`
 */
wikilinksRouter.get("/admin/title-collisions", (c) => {
  const groups = sqlite
    .prepare(
      `SELECT LOWER(TRIM(title)) AS normalized, COUNT(*) AS n
       FROM items_active
       WHERE title != ''
       GROUP BY LOWER(TRIM(title))
       HAVING n >= 2
       ORDER BY n DESC, normalized ASC`,
    )
    .all() as { normalized: string; n: number }[];

  const collisions: Array<{
    normalized: string;
    rows: Array<{ id: string; title: string; type: string; status: string; modified: string }>;
  }> = [];

  for (const group of groups) {
    // Re-run the allowlist predicate per group rather than baking the list
    // into SQL — keeps the allowlist source-of-truth in src/lib/wikilink.ts.
    if (isTitleInAllowlist(group.normalized)) continue;
    if (normalizeTitleForUniqueness(group.normalized) === "") continue;

    const rows = sqlite
      .prepare(
        `SELECT id, title, type, status, modified
         FROM items_active
         WHERE LOWER(TRIM(title)) = ?
         ORDER BY modified DESC`,
      )
      .all(group.normalized) as Array<{
      id: string;
      title: string;
      type: string;
      status: string;
      modified: string;
    }>;
    collisions.push({ normalized: group.normalized, rows });
  }

  return c.json({ collisions, total: collisions.length });
});

/**
 * DX-2 dry-run preview for title rename. Stateless: returns what
 * `applyTitleRename` would do without committing. Agents call this before
 * `sparkle_update_note({ title })` to surface scope to the user.
 *
 * Query params:
 *   - target_id (UUID, required): the item whose title is changing
 *   - new_title (string, required): the proposed new title
 *
 * Response: `{ would_rewrite_count, would_rewrite_source_ids, would_skip_share_token_source_ids, preview: [{source_id, source_title, snippet}] }`
 *
 * Returns 404 when target_id doesn't exist in items_active.
 */
wikilinksRouter.get("/admin/preview-rename", (c) => {
  const targetId = c.req.query("target_id");
  const newTitle = c.req.query("new_title");
  if (!targetId || !newTitle) {
    return c.json({ error: "MISSING_PARAMS" }, 400);
  }

  const target = sqlite.prepare("SELECT title FROM items_active WHERE id = ?").get(targetId) as
    | { title: string }
    | undefined;
  if (!target) {
    return c.json({ error: "TARGET_NOT_FOUND", target_id: targetId }, 404);
  }

  const result = previewTitleRename(sqlite, targetId, target.title, newTitle);
  return c.json({
    target_id: targetId,
    old_title: target.title,
    new_title: newTitle,
    would_rewrite_count: result.wouldRewriteCount,
    would_rewrite_source_ids: result.wouldRewriteSourceIds,
    would_skip_share_token_source_ids: result.wouldSkipShareTokenSourceIds,
    preview: result.preview,
  });
});

export { wikilinksRouter };
