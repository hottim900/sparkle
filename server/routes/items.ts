import { Hono } from "hono";
import { db, sqlite } from "../db/index.js";
import {
  createItem,
  getItem,
  listItems,
  updateItem,
  deleteItem,
  getAllTags,
} from "../lib/items.js";
import {
  createItemSchema,
  updateItemSchema,
  listItemsSchema,
} from "../schemas/items.js";
import { ZodError } from "zod";

const itemsRouter = new Hono();

// List items with filters
itemsRouter.get("/", (c) => {
  try {
    const query = listItemsSchema.parse({
      status: c.req.query("status"),
      type: c.req.query("type"),
      tag: c.req.query("tag"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });
    const result = listItems(db, query);
    return c.json(result);
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.errors[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// Create item
itemsRouter.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const input = createItemSchema.parse(body);
    const item = createItem(db, input);
    return c.json(item, 201);
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.errors[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// Get single item
itemsRouter.get("/:id", (c) => {
  const item = getItem(db, c.req.param("id"));
  if (!item) {
    return c.json({ error: "Item not found" }, 404);
  }
  return c.json(item);
});

// Update item
itemsRouter.patch("/:id", async (c) => {
  try {
    const body = await c.req.json();
    const input = updateItemSchema.parse(body);
    const updated = updateItem(db, c.req.param("id"), input);
    if (!updated) {
      return c.json({ error: "Item not found" }, 404);
    }
    return c.json(updated);
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.errors[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// Delete item
itemsRouter.delete("/:id", (c) => {
  const deleted = deleteItem(db, c.req.param("id"));
  if (!deleted) {
    return c.json({ error: "Item not found" }, 404);
  }
  return c.json({ ok: true });
});

export { itemsRouter };
