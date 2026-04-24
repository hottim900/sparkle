import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { db, sqlite } from "../db/index.js";
import { itemsActive } from "../db/schema.js";
import {
  createItem,
  getItem,
  getItemForLookup,
  listItems,
  updateItem,
  deleteItem,
  deleteVaultItem,
} from "../lib/items.js";
import { resolveLinkedInfoActive } from "../lib/item-enrichment.js";
import { isValidTypeStatus, getAutoMappedStatus } from "../lib/item-type-system.js";
import type { ExportableItem } from "../lib/export.js";
import {
  createItemSchema,
  updateItemSchema,
  listItemsSchema,
  batchSchema,
} from "../schemas/items.js";
import {
  exportToObsidian,
  resolveSparkleReferences,
  commitExportToVault,
  type ItemLookup,
} from "../lib/export.js";
import { getObsidianSettings } from "../lib/settings.js";
import { ZodError } from "zod";
import { revokeSharesByItemId } from "../lib/shares.js";
import { deriveTitleFromContent } from "../lib/title-derivation.js";
import { vaultReadonlyPayload } from "../lib/vault-errors.js";

const lookupItem: ItemLookup = (shortId) => {
  const found = getItemForLookup(db, shortId);
  return found ? { title: found.title } : null;
};

const itemsRouter = new Hono();

// List items with filters (active table only)
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
      paused: c.req.query("paused"),
      include_vault: c.req.query("include_vault"),
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

// Create item (always active)
itemsRouter.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const input = createItemSchema.parse(body);

    const title = input.title ?? deriveTitleFromContent(input.content ?? "");
    const created = createItem(db, { ...input, title });
    const [item] = resolveLinkedInfoActive(db, [created]);
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
      const result = db
        .delete(itemsActive)
        .where(and(inArray(itemsActive.id, ids), eq(itemsActive.is_private, 0)))
        .run();
      affected = result.changes;
      skipped = ids.length - affected;
    } else if (action === "develop") {
      const result = db
        .update(itemsActive)
        .set({ status: "developing", modified: now })
        .where(
          and(
            inArray(itemsActive.id, ids),
            eq(itemsActive.type, "note"),
            eq(itemsActive.status, "fleeting"),
            eq(itemsActive.is_private, 0),
          ),
        )
        .run();
      affected = result.changes;
      skipped = ids.length - affected;
    } else if (action === "mature") {
      const result = db
        .update(itemsActive)
        .set({ status: "permanent", modified: now })
        .where(
          and(
            inArray(itemsActive.id, ids),
            eq(itemsActive.type, "note"),
            eq(itemsActive.status, "developing"),
            eq(itemsActive.is_private, 0),
          ),
        )
        .run();
      affected = result.changes;
      skipped = ids.length - affected;
    } else if (action === "export") {
      const obsidian = getObsidianSettings(sqlite);
      if (!obsidian.obsidian_enabled || !obsidian.obsidian_vault_path) {
        return c.json({ error: "Obsidian export is not configured" }, 400);
      }
      const exportConfig = {
        vaultPath: obsidian.obsidian_vault_path,
        inboxFolder: obsidian.obsidian_inbox_folder,
        exportMode: obsidian.obsidian_export_mode,
      };
      // 1. Bulk fetch eligible permanent notes from items_active.
      const eligible = db
        .select({
          id: itemsActive.id,
          type: itemsActive.type,
          title: itemsActive.title,
          content: itemsActive.content,
          status: itemsActive.status,
          priority: itemsActive.priority,
          due: itemsActive.due,
          tags: itemsActive.tags,
          origin: itemsActive.origin,
          source: itemsActive.source,
          aliases: itemsActive.aliases,
          linked_note_id: itemsActive.linked_note_id,
          category_id: itemsActive.category_id,
          is_private: itemsActive.is_private,
          created: itemsActive.created,
          modified: itemsActive.modified,
        })
        .from(itemsActive)
        .where(
          and(
            inArray(itemsActive.id, ids),
            eq(itemsActive.type, "note"),
            eq(itemsActive.status, "permanent"),
            eq(itemsActive.is_private, 0),
          ),
        )
        .all();
      const errors: { id: string; error: string }[] = [];
      const exportedResults: {
        id: string;
        path: string;
        item: (typeof eligible)[number];
      }[] = [];
      const skippedIds: string[] = [];
      // 2. Loop: file-write-first (exportToObsidian), then atomic DB move below.
      for (const item of eligible) {
        try {
          const resolvedContent = resolveSparkleReferences(item.content || "", lookupItem);
          const exportItem = {
            ...item,
            content: resolvedContent,
          } as ExportableItem;
          const result = await exportToObsidian(exportItem, exportConfig);
          if (result.skipped) {
            skippedIds.push(item.id);
          } else {
            exportedResults.push({ id: item.id, path: result.path, item });
          }
        } catch (e) {
          errors.push({ id: item.id, error: (e as Error).message });
        }
      }
      // 3. Atomic move per item: INSERT vault + DELETE active.
      let committed = 0;
      for (const { path, item } of exportedResults) {
        try {
          commitExportToVault(
            sqlite,
            {
              id: item.id,
              title: item.title,
              category_id: item.category_id,
              tags: item.tags,
              aliases: item.aliases,
              source: item.source,
              origin: item.origin,
              created: item.created,
              is_private: item.is_private ?? 0,
              content: item.content,
            },
            path,
          );
          committed++;
        } catch (e) {
          errors.push({ id: item.id, error: (e as Error).message });
        }
      }
      affected = committed;
      skipped = skippedIds.length + (ids.length - eligible.length);
      return c.json({ affected, skipped, errors });
    } else if (action === "done") {
      const result = db
        .update(itemsActive)
        .set({
          status: "done",
          modified: now,
          paused: 0,
          paused_at: null,
          paused_context: null,
        })
        .where(
          and(
            inArray(itemsActive.id, ids),
            eq(itemsActive.type, "todo"),
            eq(itemsActive.is_private, 0),
          ),
        )
        .run();
      affected = result.changes;
      skipped = ids.length - affected;
    } else if (action === "active") {
      const result = db
        .update(itemsActive)
        .set({ status: "active", modified: now })
        .where(
          and(
            inArray(itemsActive.id, ids),
            eq(itemsActive.type, "todo"),
            eq(itemsActive.is_private, 0),
          ),
        )
        .run();
      affected = result.changes;
      skipped = ids.length - affected;
    } else {
      // archive
      const result = db
        .update(itemsActive)
        .set({
          status: "archived",
          modified: now,
          paused: 0,
          paused_at: null,
          paused_context: null,
        })
        .where(and(inArray(itemsActive.id, ids), eq(itemsActive.is_private, 0)))
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

// Get linked todos for a note — active-only (todos that reference this note)
itemsRouter.get("/:id/linked-todos", (c) => {
  const id = c.req.param("id");
  const note = getItem(db, id, false);
  if (!note) return c.json({ error: "Item not found" }, 404);
  const result = listItems(db, { linked_note_id: id, paused: "all" });
  return c.json({ items: result.items });
});

// Export item to Obsidian — moves items_active → items_vault atomically
itemsRouter.post("/:id/export", async (c) => {
  const item = getItem(db, c.req.param("id"));
  if (!item) {
    return c.json({ error: "Item not found" }, 404);
  }
  if (item.origin === "vault") {
    return c.json(
      { ...vaultReadonlyPayload(item.export_path), error: "已匯出的項目無法再次匯出" },
      409,
    );
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
    const resolvedContent = resolveSparkleReferences(item.content || "", lookupItem);
    const exportItem = { ...item, content: resolvedContent } as ExportableItem;
    const result = await exportToObsidian(exportItem, {
      vaultPath: obsidian.obsidian_vault_path,
      inboxFolder: obsidian.obsidian_inbox_folder,
      exportMode: obsidian.obsidian_export_mode,
    });
    if (!result.skipped) {
      commitExportToVault(
        sqlite,
        {
          id: item.id,
          title: item.title,
          category_id: item.category_id,
          tags: item.tags,
          aliases: item.aliases,
          source: item.source,
          origin: item.origin_source,
          created: item.created,
          is_private: item.is_private,
          content: item.content,
        },
        result.path,
      );
    }
    return c.json({ path: result.path, skipped: result.skipped });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// Get single item (supports full UUID or short ID prefix; cross-table)
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

// Update item — vault-origin returns 409 VAULT_READONLY
itemsRouter.patch("/:id", async (c) => {
  try {
    const body = await c.req.json();
    const input = updateItemSchema.parse(body);
    const id = c.req.param("id");

    const existing = getItem(db, id);
    if (!existing) {
      return c.json({ error: "Item not found" }, 404);
    }

    if (existing.origin === "vault") {
      return c.json(vaultReadonlyPayload(existing.export_path), 409);
    }

    // Private items cannot be converted to scratch
    if (input.type === "scratch" && (existing.is_private || input.is_private)) {
      return c.json({ error: "Private items cannot be converted to scratch" }, 400);
    }

    const effectiveType = input.type ?? existing.type;
    let effectiveStatus = input.status ?? existing.status ?? "fleeting";

    if (input.type !== undefined && input.type !== existing.type) {
      const mappedStatus = getAutoMappedStatus(
        existing.type,
        input.type,
        existing.status ?? "fleeting",
      );
      if (mappedStatus) {
        effectiveStatus = mappedStatus as typeof effectiveStatus;
        input.status = effectiveStatus as typeof input.status;
      }
    }

    if (!isValidTypeStatus(effectiveType, effectiveStatus)) {
      return c.json(
        { error: `Invalid status '${effectiveStatus}' for type '${effectiveType}'` },
        400,
      );
    }

    const markingPrivate = input.is_private === true && !existing.is_private;
    const updated = updateItem(db, id, input, markingPrivate, existing);
    if (!updated) {
      return c.json({ error: "Item not found" }, 404);
    }

    if (markingPrivate) {
      revokeSharesByItemId(sqlite, id);
    }

    return c.json(updated);
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// Release a vault stub — hard-deletes items_vault row + nulls vault_files.sparkle_id.
// vault .md file is preserved; Sparkle simply stops tracking it. Linked todos
// become dangling (linked_note_origin: 'missing' in subsequent responses).
itemsRouter.delete("/:id/vault-stub", (c) => {
  const id = c.req.param("id");
  const existing = getItem(db, id, false);
  if (!existing) {
    // 409 vs 404: we can't distinguish "was released" from "never existed at
    // this endpoint" once the row is gone, but both are surface-equivalent
    // from the caller's POV ("this stub is not mine to release anymore"),
    // and the design contract (dialog copy + toast) treats that as 已釋出.
    // Reserve 404 strictly for the wrong-endpoint case below (NOT_VAULT_ITEM).
    return c.json(
      {
        error: "此筆記已釋出或不存在",
        error_en: "Vault stub not found — already released or never existed.",
        code: "ALREADY_RELEASED",
      },
      409,
    );
  }
  if (existing.origin !== "vault") {
    return c.json(
      {
        error: "此端點只能釋出 vault 項目；active 項目請用 DELETE /api/items/:id",
        error_en:
          "This endpoint only releases vault items; use DELETE /api/items/:id for active items.",
        code: "NOT_VAULT_ITEM",
      },
      404,
    );
  }
  const released = deleteVaultItem(sqlite, existing.id);
  if (!released) {
    // Row disappeared between getItem and deleteVaultItem (concurrent release) —
    // same 409 semantics.
    return c.json(
      {
        error: "此筆記已釋出或不存在",
        error_en: "Vault stub not found — already released or never existed.",
        code: "ALREADY_RELEASED",
      },
      409,
    );
  }
  return c.json({ ok: true, id: released.id, export_path: released.export_path });
});

// Delete item — vault-origin returns 409 (use /vault-stub endpoint to release)
itemsRouter.delete("/:id", (c) => {
  const id = c.req.param("id");
  const existing = getItem(db, id, false);
  if (!existing) {
    return c.json({ error: "Item not found" }, 404);
  }
  if (existing.origin === "vault") {
    return c.json(vaultReadonlyPayload(existing.export_path), 409);
  }
  const deleted = deleteItem(db, id);
  if (!deleted) {
    return c.json({ error: "Item not found" }, 404);
  }
  return c.json({ ok: true });
});

export { itemsRouter };
