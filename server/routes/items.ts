import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { db, sqlite } from "../db/index.js";
import { items, categories } from "../db/schema.js";
import { createItem, getItem, listItems, updateItem, deleteItem } from "../lib/items.js";
import { isValidTypeStatus, getAutoMappedStatus } from "../lib/item-type-system.js";
import type { ExportableItem } from "../lib/export.js";
import {
  createItemSchema,
  updateItemSchema,
  listItemsSchema,
  batchSchema,
} from "../schemas/items.js";
import { exportToObsidian } from "../lib/export.js";
import { getObsidianSettings } from "../lib/settings.js";
import { ZodError } from "zod";

const itemsRouter = new Hono();

// List items with filters
itemsRouter.get("/", (c) => {
  try {
    const query = listItemsSchema.parse({
      status: c.req.query("status"),
      excludeStatus: c.req.query("excludeStatus"),
      type: c.req.query("type"),
      tag: c.req.query("tag"),
      category_id: c.req.query("category_id"),
      sort: c.req.query("sort"),
      order: c.req.query("order"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });
    const result = listItems(db, query);
    return c.json(result);
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// Create item
itemsRouter.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const input = createItemSchema.parse(body);

    // Validate type-status combination if explicit status provided
    if (input.status && !isValidTypeStatus(input.type ?? "note", input.status)) {
      return c.json(
        { error: `Invalid status '${input.status}' for type '${input.type ?? "note"}'` },
        400,
      );
    }

    const created = createItem(db, input);
    const item = getItem(db, created.id)!;
    return c.json(item, 201);
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// Batch operations
itemsRouter.post("/batch", async (c) => {
  try {
    const body = await c.req.json();
    const { ids, action } = batchSchema.parse(body);

    let affected = 0;
    let skipped = 0;

    const now = new Date().toISOString();

    if (action === "delete") {
      const result = db.delete(items).where(inArray(items.id, ids)).run();
      affected = result.changes;
      skipped = ids.length - affected;
    } else if (action === "develop") {
      // fleeting → developing (notes only)
      const result = db
        .update(items)
        .set({ status: "developing", modified: now })
        .where(and(inArray(items.id, ids), eq(items.type, "note"), eq(items.status, "fleeting")))
        .run();
      affected = result.changes;
      skipped = ids.length - affected;
    } else if (action === "mature") {
      // developing → permanent (notes only)
      const result = db
        .update(items)
        .set({ status: "permanent", modified: now })
        .where(and(inArray(items.id, ids), eq(items.type, "note"), eq(items.status, "developing")))
        .run();
      affected = result.changes;
      skipped = ids.length - affected;
    } else if (action === "export") {
      // permanent → exported (notes only, writes .md)
      const obsidian = getObsidianSettings(sqlite);
      if (!obsidian.obsidian_enabled || !obsidian.obsidian_vault_path) {
        return c.json({ error: "Obsidian export is not configured" }, 400);
      }
      const exportConfig = {
        vaultPath: obsidian.obsidian_vault_path,
        inboxFolder: obsidian.obsidian_inbox_folder,
        exportMode: obsidian.obsidian_export_mode,
      };
      // 1. Bulk fetch eligible items with category names
      const eligible = db
        .select({
          id: items.id,
          type: items.type,
          title: items.title,
          content: items.content,
          status: items.status,
          priority: items.priority,
          due: items.due,
          tags: items.tags,
          origin: items.origin,
          source: items.source,
          aliases: items.aliases,
          linked_note_id: items.linked_note_id,
          category_id: items.category_id,
          created: items.created,
          modified: items.modified,
          category_name: categories.name,
        })
        .from(items)
        .leftJoin(categories, eq(items.category_id, categories.id))
        .where(and(inArray(items.id, ids), eq(items.type, "note"), eq(items.status, "permanent")))
        .all();
      // 2. Loop export (file I/O, unavoidable)
      const errors: { id: string; error: string }[] = [];
      const exportedIds: string[] = [];
      for (const item of eligible) {
        try {
          exportToObsidian(item as ExportableItem, exportConfig);
          exportedIds.push(item.id);
        } catch (e) {
          errors.push({ id: item.id, error: (e as Error).message });
        }
      }
      // 3. Bulk update exported items (1 query)
      if (exportedIds.length > 0) {
        db.update(items)
          .set({ status: "exported", modified: now })
          .where(inArray(items.id, exportedIds))
          .run();
      }
      affected = exportedIds.length;
      skipped = ids.length - affected - errors.length;
      return c.json({ affected, skipped, errors });
    } else if (action === "done") {
      // → done (todo only, any status)
      const result = db
        .update(items)
        .set({ status: "done", modified: now })
        .where(and(inArray(items.id, ids), eq(items.type, "todo")))
        .run();
      affected = result.changes;
      skipped = ids.length - affected;
    } else if (action === "active") {
      // → active (todo only, any status)
      const result = db
        .update(items)
        .set({ status: "active", modified: now })
        .where(and(inArray(items.id, ids), eq(items.type, "todo")))
        .run();
      affected = result.changes;
      skipped = ids.length - affected;
    } else {
      // archive — any type
      const result = db
        .update(items)
        .set({ status: "archived", modified: now })
        .where(inArray(items.id, ids))
        .run();
      affected = result.changes;
      skipped = ids.length - affected;
    }

    return c.json({ affected, skipped });
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// Get linked todos for a note
itemsRouter.get("/:id/linked-todos", (c) => {
  const id = c.req.param("id");
  const result = listItems(db, { linked_note_id: id });
  return c.json({ items: result.items });
});

// Export item to Obsidian
itemsRouter.post("/:id/export", (c) => {
  const item = getItem(db, c.req.param("id"));
  if (!item) {
    return c.json({ error: "Item not found" }, 404);
  }
  if (item.type !== "note") {
    return c.json({ error: "Only notes can be exported" }, 400);
  }
  if (item.status !== "permanent") {
    return c.json({ error: "Only permanent notes can be exported" }, 400);
  }
  const obsidian = getObsidianSettings(sqlite);
  if (!obsidian.obsidian_enabled || !obsidian.obsidian_vault_path) {
    return c.json({ error: "Obsidian export is not configured" }, 500);
  }

  try {
    const result = exportToObsidian(item, {
      vaultPath: obsidian.obsidian_vault_path,
      inboxFolder: obsidian.obsidian_inbox_folder,
      exportMode: obsidian.obsidian_export_mode,
    });
    updateItem(db, item.id, { status: "exported" });
    return c.json({ path: result.path });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// Get single item (supports full UUID or short ID prefix)
itemsRouter.get("/:id", (c) => {
  try {
    const item = getItem(db, c.req.param("id"));
    if (!item) {
      return c.json({ error: "Item not found" }, 404);
    }
    return c.json(item);
  } catch (e) {
    if ((e as { status?: number }).status === 409) {
      return c.json(
        {
          error: (e as Error).message,
          matches: (e as { matches: string[] }).matches,
        },
        409,
      );
    }
    throw e;
  }
});

// Update item
itemsRouter.patch("/:id", async (c) => {
  try {
    const body = await c.req.json();
    const input = updateItemSchema.parse(body);
    const id = c.req.param("id");

    const existing = getItem(db, id);
    if (!existing) {
      return c.json({ error: "Item not found" }, 404);
    }

    // Determine effective type and status after update
    const effectiveType = input.type ?? existing.type;
    let effectiveStatus = input.status ?? existing.status;

    // Type conversion auto-mapping overrides explicit status
    if (input.type !== undefined && input.type !== existing.type) {
      const mappedStatus = getAutoMappedStatus(existing.type, input.type, existing.status);
      if (mappedStatus) {
        effectiveStatus = mappedStatus as typeof effectiveStatus;
        input.status = effectiveStatus as typeof input.status;
      }
    }

    // Validate type-status combination
    if (!isValidTypeStatus(effectiveType, effectiveStatus)) {
      return c.json(
        { error: `Invalid status '${effectiveStatus}' for type '${effectiveType}'` },
        400,
      );
    }

    const updated = updateItem(db, id, input);
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

// Delete item
itemsRouter.delete("/:id", (c) => {
  const deleted = deleteItem(db, c.req.param("id"));
  if (!deleted) {
    return c.json({ error: "Item not found" }, 404);
  }
  return c.json({ ok: true });
});

export { itemsRouter };
