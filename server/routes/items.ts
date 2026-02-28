import { Hono } from "hono";
import { db, sqlite } from "../db/index.js";
import {
  createItem,
  getItem,
  listItems,
  updateItem,
  deleteItem,
  isValidTypeStatus,
  getAutoMappedStatus,
} from "../lib/items.js";
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
      sort: c.req.query("sort"),
      order: c.req.query("order"),
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
      return c.json({ error: e.errors[0]?.message ?? "Validation error" }, 400);
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
    const errors: { id: string; error: string }[] = [];

    if (action === "delete") {
      for (const id of ids) {
        if (deleteItem(db, id)) {
          affected++;
        } else {
          skipped++;
        }
      }
    } else if (action === "develop") {
      // fleeting → developing (notes only)
      for (const id of ids) {
        const item = getItem(db, id);
        if (!item || item.type !== "note" || item.status !== "fleeting") {
          skipped++;
          continue;
        }
        if (updateItem(db, id, { status: "developing" })) affected++;
        else skipped++;
      }
    } else if (action === "mature") {
      // developing → permanent (notes only)
      for (const id of ids) {
        const item = getItem(db, id);
        if (!item || item.type !== "note" || item.status !== "developing") {
          skipped++;
          continue;
        }
        if (updateItem(db, id, { status: "permanent" })) affected++;
        else skipped++;
      }
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
      for (const id of ids) {
        const item = getItem(db, id);
        if (!item || item.type !== "note" || item.status !== "permanent") {
          skipped++;
          continue;
        }
        try {
          exportToObsidian(item, exportConfig);
          updateItem(db, id, { status: "exported" });
          affected++;
        } catch (e) {
          errors.push({ id, error: (e as Error).message });
          skipped++;
        }
      }
      return c.json({ affected, skipped, errors });
    } else if (action === "done") {
      // → done (todo only)
      for (const id of ids) {
        const item = getItem(db, id);
        if (!item || item.type !== "todo") {
          skipped++;
          continue;
        }
        if (updateItem(db, id, { status: "done" })) affected++;
        else skipped++;
      }
    } else if (action === "active") {
      // → active (todo only)
      for (const id of ids) {
        const item = getItem(db, id);
        if (!item || item.type !== "todo") {
          skipped++;
          continue;
        }
        if (updateItem(db, id, { status: "active" })) affected++;
        else skipped++;
      }
    } else {
      // archive — any type
      const statusMap = { archive: "archived" } as const;
      const status = statusMap[action as keyof typeof statusMap];
      for (const id of ids) {
        if (updateItem(db, id, { status })) affected++;
        else skipped++;
      }
    }

    return c.json({ affected, skipped });
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.errors[0]?.message ?? "Validation error" }, 400);
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
