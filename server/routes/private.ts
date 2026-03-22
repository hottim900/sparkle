import { Hono } from "hono";
import { ZodError } from "zod";
import { db, sqlite } from "../db/index.js";
import { getSetting } from "../lib/settings.js";
import { hashPin, verifyPin } from "../lib/pin.js";
import { createSession, destroySession } from "../lib/private-session.js";
import { setupPinSchema, unlockSchema, changePinSchema } from "../schemas/private.js";
import {
  createItem,
  getItem,
  listItems,
  updateItem,
  deleteItem,
  searchItems,
} from "../lib/items.js";
import {
  createItemSchema,
  updateItemSchema,
  listItemsSchema,
  searchSchema,
} from "../schemas/items.js";

const privateRouter = new Hono();

// GET /status — Check if PIN is configured
privateRouter.get("/status", (c) => {
  const hash = getSetting(sqlite, "private_pin_hash");
  return c.json({ configured: !!hash });
});

// POST /setup — First-time PIN setup
privateRouter.post("/setup", async (c) => {
  try {
    const body = await c.req.json();
    const { pin } = setupPinSchema.parse(body);

    const existing = getSetting(sqlite, "private_pin_hash");
    if (existing) {
      return c.json({ error: "PIN already configured" }, 409);
    }

    const hash = await hashPin(pin);
    sqlite.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("private_pin_hash", hash);

    return c.json({ success: true });
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// POST /unlock — Verify PIN, return session token
privateRouter.post("/unlock", async (c) => {
  try {
    const body = await c.req.json();
    const { pin } = unlockSchema.parse(body);

    const hash = getSetting(sqlite, "private_pin_hash");
    if (!hash) {
      return c.json({ error: "PIN not configured" }, 404);
    }

    const valid = await verifyPin(pin, hash);
    if (!valid) {
      return c.json({ error: "PIN 錯誤" }, 401);
    }

    const token = createSession();
    return c.json({ token });
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// POST /lock — Invalidate session token (requires privateTokenMiddleware)
privateRouter.post("/lock", (c) => {
  const token = c.req.header("X-Private-Token");
  if (token) {
    destroySession(token);
  }
  return c.json({ success: true });
});

// PATCH /pin — Change PIN (requires privateTokenMiddleware)
privateRouter.patch("/pin", async (c) => {
  try {
    const body = await c.req.json();
    const { old_pin, new_pin } = changePinSchema.parse(body);

    const hash = getSetting(sqlite, "private_pin_hash");
    if (!hash) {
      return c.json({ error: "PIN not configured" }, 404);
    }

    const valid = await verifyPin(old_pin, hash);
    if (!valid) {
      return c.json({ error: "PIN 錯誤" }, 401);
    }

    const newHash = await hashPin(new_pin);
    sqlite
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run("private_pin_hash", newHash);

    return c.json({ success: true });
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// ============================================================
// CRUD endpoints (all require privateTokenMiddleware via index.ts)
// ============================================================

// GET /items — List private items
privateRouter.get("/items", (c) => {
  try {
    const query = listItemsSchema.parse({
      status: c.req.query("status"),
      type: c.req.query("type"),
      tag: c.req.query("tag"),
      sort: c.req.query("sort"),
      order: c.req.query("order"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });
    const result = listItems(db, { ...query, is_private: 1 }, true);
    return c.json(result);
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// POST /items — Create private item
privateRouter.post("/items", async (c) => {
  try {
    const body = await c.req.json();
    const input = createItemSchema.parse(body);

    const created = createItem(db, { ...input, is_private: true });
    const item = getItem(db, created.id, true, true)!;
    return c.json(item, 201);
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// GET /items/:id — Get single private item
privateRouter.get("/items/:id", (c) => {
  const item = getItem(db, c.req.param("id"), true, true);
  if (!item || !item.is_private) {
    return c.json({ error: "Item not found" }, 404);
  }
  return c.json(item);
});

// PATCH /items/:id — Update private item
privateRouter.patch("/items/:id", async (c) => {
  try {
    const body = await c.req.json();
    const input = updateItemSchema.parse(body);
    const id = c.req.param("id");

    // Verify item exists and is private before updating
    const existing = getItem(db, id, false, true);
    if (!existing || !existing.is_private) {
      return c.json({ error: "Item not found" }, 404);
    }

    const updated = updateItem(db, id, input, true);
    if (!updated) {
      return c.json({ error: "Item not found" }, 404);
    }
    return c.json(updated);
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// DELETE /items/:id — Delete private item
privateRouter.delete("/items/:id", (c) => {
  const id = c.req.param("id");
  const existing = getItem(db, id, false, true);
  if (!existing || !existing.is_private) {
    return c.json({ error: "Item not found" }, 404);
  }

  deleteItem(db, id);
  return c.body(null, 204);
});

// GET /search — Search private items
privateRouter.get("/search", (c) => {
  try {
    const query = searchSchema.parse({
      q: c.req.query("q"),
      limit: c.req.query("limit"),
    });

    // Search with includePrivate=true, then filter to only private items
    const allResults = searchItems(sqlite, db, query.q, query.limit, true, true);
    const results = allResults.filter((item) => item.is_private);
    return c.json({ results });
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// GET /tags — List tags from private items only
privateRouter.get("/tags", (c) => {
  const stmt = sqlite.prepare(`
    SELECT DISTINCT value as tag
    FROM items, json_each(items.tags)
    WHERE value != '' AND items.is_private = 1
    ORDER BY value
  `);
  const rows = stmt.all() as { tag: string }[];
  const tags = rows.map((r) => r.tag);
  return c.json({ tags });
});

export { privateRouter };
