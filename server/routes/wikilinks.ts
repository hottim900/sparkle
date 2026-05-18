import { Hono } from "hono";
import { sqlite } from "../db/index.js";
import { resolveWikilinkTitle } from "../lib/wikilink.js";
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

export { wikilinksRouter };
