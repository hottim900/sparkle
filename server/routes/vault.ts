import { Hono } from "hono";
import { resolve, normalize } from "node:path";
import { db, sqlite } from "../db/index.js";
import { vaultFiles } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { getObsidianSettings } from "../lib/settings.js";
import { logger } from "../lib/logger.js";

const vaultRouter = new Hono();

/**
 * GET /api/vault?q=keyword&limit=20
 * FTS5 search across vault files. Returns snippets.
 */
vaultRouter.get("/", (c) => {
  const q = c.req.query("q")?.trim();
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "20", 10) || 20, 1), 100);

  if (!q) {
    // No query: return recent files by mtime
    const recent = db
      .select({
        path: vaultFiles.path,
        title: vaultFiles.title,
        mtime: vaultFiles.mtime,
      })
      .from(vaultFiles)
      .orderBy(sql`${vaultFiles.mtime} DESC`)
      .limit(limit)
      .all();
    return c.json({ results: recent, total: recent.length });
  }

  // FTS5 search
  try {
    const results = sqlite
      .prepare(
        `SELECT vf.path, vf.title, vf.mtime,
                snippet(vault_files_fts, 1, '<mark>', '</mark>', '...', 40) as snippet
         FROM vault_files_fts
         JOIN vault_files vf ON vf.rowid = vault_files_fts.rowid
         WHERE vault_files_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(q, limit) as { path: string; title: string; mtime: number; snippet: string }[];

    return c.json({ results, total: results.length });
  } catch (e) {
    // FTS5 query syntax error (e.g., unmatched quotes)
    logger.warn(`vault search error: ${(e as Error).message}`);
    return c.json({ results: [], total: 0, error: "搜尋語法錯誤" }, 400);
  }
});

/**
 * GET /api/vault/file/*path
 * Read a single vault file by path. Path traversal protected.
 */
vaultRouter.get("/file/*", (c) => {
  const obsidian = getObsidianSettings(sqlite);
  if (!obsidian.obsidian_enabled || !obsidian.obsidian_vault_path) {
    return c.json({ error: "Obsidian is not configured" }, 500);
  }

  // Extract path from wildcard
  const requestedPath = c.req.path.replace(/^\/api\/vault\/file\//, "");
  if (!requestedPath) {
    return c.json({ error: "Path is required" }, 400);
  }

  // Path traversal protection (trailing / prevents sibling-directory bypass)
  const vaultRoot = resolve(obsidian.obsidian_vault_path);
  const vaultPrefix = vaultRoot.endsWith("/") ? vaultRoot : vaultRoot + "/";
  const resolved = resolve(vaultRoot, normalize(requestedPath));
  if (resolved !== vaultRoot && !resolved.startsWith(vaultPrefix)) {
    return c.json({ error: "Invalid path" }, 403);
  }

  // Look up in DB (not filesystem — the scanner indexes everything)
  const file = db.select().from(vaultFiles).where(eq(vaultFiles.path, requestedPath)).get();

  if (!file) {
    return c.json({ error: "File not found" }, 404);
  }

  return c.json({
    path: file.path,
    title: file.title,
    frontmatter: file.frontmatter,
    content: file.content,
    mtime: file.mtime,
  });
});

export { vaultRouter };
