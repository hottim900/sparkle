import { Hono } from "hono";
import { sqlite } from "../db/index.js";
import {
  createShareToken,
  listShares,
  revokeShare,
  getSharesByItemId,
} from "../lib/shares.js";
import { createShareSchema } from "../schemas/shares.js";
import { ZodError } from "zod";

const sharesRouter = new Hono();

// Create share for an item
sharesRouter.post("/items/:id/share", async (c) => {
  try {
    const itemId = c.req.param("id");
    const body = await c.req.json();
    const { visibility } = createShareSchema.parse(body);

    const share = createShareToken(sqlite, itemId, visibility);
    if (!share) {
      // Check why it failed — item not found or not a note
      const item = sqlite
        .prepare("SELECT id, type FROM items WHERE id = ?")
        .get(itemId) as { id: string; type: string } | undefined;

      if (!item) {
        return c.json({ error: "Item not found" }, 404);
      }
      return c.json({ error: "Only notes can be shared" }, 400);
    }

    return c.json({ share, url: `/s/${share.token}` }, 201);
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json(
        { error: e.errors[0]?.message ?? "Validation error" },
        400,
      );
    }
    throw e;
  }
});

// List all shares
sharesRouter.get("/shares", (c) => {
  const shares = listShares(sqlite);
  return c.json({ shares });
});

// Get shares for a specific item
sharesRouter.get("/items/:id/shares", (c) => {
  const itemId = c.req.param("id");
  const shares = getSharesByItemId(sqlite, itemId);
  return c.json({ shares });
});

// Revoke a share
sharesRouter.delete("/shares/:id", (c) => {
  const shareId = c.req.param("id");
  const deleted = revokeShare(sqlite, shareId);
  if (!deleted) {
    return c.json({ error: "Share not found" }, 404);
  }
  return c.json({ ok: true });
});

export { sharesRouter };
