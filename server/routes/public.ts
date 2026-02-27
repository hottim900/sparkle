import { Hono } from "hono";
import { sqlite } from "../db/index.js";
import { getShareByToken, listPublicShares } from "../lib/shares.js";
import { renderPublicPage, renderNotFoundPage } from "../lib/render-public-page.js";

const publicRouter = new Hono();

// Get shared note by token (JSON API)
publicRouter.get("/api/public/:token", (c) => {
  const token = c.req.param("token");
  const share = getShareByToken(sqlite, token);

  if (!share) {
    return c.json({ error: "Share not found" }, 404);
  }

  let tags: string[] = [];
  try {
    tags = JSON.parse(share.item_tags);
  } catch {
    tags = [];
  }

  return c.json({
    token: share.token,
    title: share.item_title,
    content: share.item_content,
    tags,
    created: share.item_created,
    modified: share.item_modified,
    visibility: share.visibility,
  });
});

// List public shares (JSON API)
publicRouter.get("/api/public", (c) => {
  const shares = listPublicShares(sqlite);
  return c.json({
    shares: shares.map((s) => ({
      token: s.token,
      title: s.item_title,
      created: s.created,
    })),
  });
});

// Server-rendered public page
publicRouter.get("/s/:token", (c) => {
  const token = c.req.param("token");
  const share = getShareByToken(sqlite, token);

  if (!share) {
    return c.html(renderNotFoundPage(), 404);
  }

  let tags: string[] = [];
  try {
    tags = JSON.parse(share.item_tags);
  } catch {
    tags = [];
  }

  const html = renderPublicPage({
    title: share.item_title,
    content: share.item_content,
    tags,
    created: share.item_created,
  });

  return c.html(html);
});

export { publicRouter };
