import { Hono } from "hono";
import { resolve, normalize } from "node:path";
import { z, ZodError } from "zod";
import { db, sqlite } from "../db/index.js";
import { vaultFiles } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { getObsidianSettings } from "../lib/settings.js";
import { escapeFts5Query } from "../lib/fts-utils.js";
import { UUID_RE } from "../lib/items.js";
import { logger } from "../lib/logger.js";

const vaultSearchSchema = z.object({
  q: z.string().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  filter: z.enum(["all", "sparkle"]).optional(),
});

const vaultRouter = new Hono();

/**
 * GET /api/vault?q=keyword&limit=20
 * FTS5 search across vault files. Returns snippets.
 */
vaultRouter.get("/", (c) => {
  let parsed;
  try {
    parsed = vaultSearchSchema.parse({
      q: c.req.query("q")?.trim() || undefined,
      limit: c.req.query("limit"),
      filter: c.req.query("filter") || undefined,
    });
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }

  const { q, limit, filter } = parsed;
  const sparkleOnly = filter === "sparkle";

  if (!q) {
    // No query: return recent files by mtime
    const recent = db
      .select({
        path: vaultFiles.path,
        title: vaultFiles.title,
        mtime: vaultFiles.mtime,
        sparkle_id: vaultFiles.sparkle_id,
      })
      .from(vaultFiles)
      .where(sparkleOnly ? sql`${vaultFiles.sparkle_id} IS NOT NULL` : undefined)
      .orderBy(sql`${vaultFiles.mtime} DESC`)
      .limit(limit)
      .all();
    return c.json({ results: recent, total: recent.length });
  }

  // FTS5 search — trigram tokenizer requires 3+ chars; shorter queries return empty (no LIKE fallback for vault performance)
  try {
    const escaped = escapeFts5Query(q);
    const sparkleClause = sparkleOnly ? "AND vf.sparkle_id IS NOT NULL" : "";
    const results = sqlite
      .prepare(
        `SELECT vf.path, vf.title, vf.mtime, vf.sparkle_id,
                snippet(vault_files_fts, 1, '<mark>', '</mark>', '...', 40) as snippet
         FROM vault_files_fts
         JOIN vault_files vf ON vf.rowid = vault_files_fts.rowid
         WHERE vault_files_fts MATCH ?
         ${sparkleClause}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(escaped, limit) as {
      path: string;
      title: string;
      mtime: number;
      sparkle_id: string | null;
      snippet: string;
    }[];

    return c.json({ results, total: results.length });
  } catch (e) {
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

/**
 * GET /api/vault/by-sparkle-id/:id
 * Look up vault file path by sparkle_id. Used by item-detail to resolve "View in Vault" links.
 */
vaultRouter.get("/by-sparkle-id/:id", (c) => {
  const id = c.req.param("id");
  if (!UUID_RE.test(id)) {
    return c.json({ error: "Invalid sparkle_id format" }, 400);
  }

  const row = db
    .select({ path: vaultFiles.path })
    .from(vaultFiles)
    .where(eq(vaultFiles.sparkle_id, id))
    .get();

  if (!row) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json({ path: row.path });
});

export { vaultRouter };
