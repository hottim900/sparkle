import { z } from "zod";
import { isValidTypeStatus } from "../lib/item-type-system.js";
import { REVISION_REGEX } from "../lib/revision.js";

// v1.4.0: "exported" removed — exported notes live in items_vault, not items_active.
// For imports that still contain status='exported' rows, use importStatusEnum below.
export const statusEnum = z.enum([
  "fleeting",
  "developing",
  "permanent",
  "active",
  "done",
  "draft",
  "archived",
]);

// Accepted in import payloads for backward-compat. v1.4.0 import handler routes
// status='exported' rows directly into items_vault (preserving pre-split exports).
export const importStatusEnum = z.enum([
  "fleeting",
  "developing",
  "permanent",
  "exported",
  "active",
  "done",
  "draft",
  "archived",
]);

export const createItemSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    type: z.enum(["note", "todo", "scratch"]).default("note"),
    content: z.string().max(50000).default(""),
    status: statusEnum.optional(),
    priority: z.enum(["low", "medium", "high"]).nullable().default(null),
    due: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")
      .nullable()
      .default(null),
    tags: z.array(z.string().min(1).max(50)).max(20).default([]),
    origin: z.string().max(200).default(""),
    source: z.string().max(2000).nullable().default(null),
    aliases: z.array(z.string().min(1).max(200)).max(10).default([]),
    linked_note_id: z.string().uuid().nullable().default(null),
    category_id: z.string().uuid().nullable().default(null),
    is_private: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "todo" && !data.title) {
      ctx.addIssue({ code: "custom", path: ["title"], message: "Title required for todo" });
    }
    if (!data.title && (!data.content || data.content.trim() === "")) {
      ctx.addIssue({ code: "custom", path: ["content"], message: "Content or title required" });
    }
  })
  .refine((data) => !data.status || isValidTypeStatus(data.type ?? "note", data.status), {
    message: "Invalid status for the given type",
    path: ["status"],
  });

export const updateItemSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  type: z.enum(["note", "todo", "scratch"]).optional(),
  content: z.string().max(50000).optional(),
  status: statusEnum.optional(),
  priority: z.enum(["low", "medium", "high"]).nullable().optional(),
  due: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")
    .nullable()
    .optional(),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  origin: z.string().max(200).optional(),
  source: z.string().max(2000).nullable().optional(),
  aliases: z.array(z.string().min(1).max(200)).max(10).optional(),
  linked_note_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  viewed_at: z.string().nullable().optional(),
  is_private: z.boolean().optional(),
  paused: z.boolean().optional(),
  paused_context: z.string().max(500).optional(),
  // Optional compare-and-swap token. When present, the server rejects the
  // update with 412 PRECONDITION_FAILED if the stored content's sha256 does
  // not match. Same wire format as MCP edit_note v2's revision.
  revision: z.string().regex(REVISION_REGEX, "Must be 64-char lowercase hex").optional(),
});

export const listItemsSchema = z.object({
  // List accepts "exported" (synthesized from items_vault); create/update still
  // reject it via statusEnum. importStatusEnum already enumerates exactly these 8.
  status: importStatusEnum.optional(),
  type: z.enum(["note", "todo", "scratch"]).optional(),
  tag: z.string().min(1).max(50).optional(),
  sort: z.enum(["created", "priority", "due", "modified"]).default("created"),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // Offset capped to prevent memory blow-up in include_vault mode, which over-fetches
  // `limit + offset` rows from each table. 10_000 * 2 * 100 rows is still sub-MB.
  offset: z.coerce.number().int().min(0).max(10000).default(0),
  excludeStatus: z
    .union([z.string().transform((s) => s.split(",").filter(Boolean)), z.array(z.string())])
    .optional(),
  category_id: z.string().uuid().optional(),
  paused: z.enum(["true", "false", "all"]).optional(),
  include_vault: z.enum(["true", "false"]).optional(),
});

export const batchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "At least one id is required").max(1000),
  action: z.enum(["archive", "done", "active", "delete", "develop", "mature", "export"]),
});

export const searchSchema = z.object({
  q: z.string().min(1, "Search query is required").max(1000),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Import schema — accepts JSON string arrays from export files
// Separate preprocessors for tags (max 50 chars) and aliases (max 200 chars) to match create/update schemas
function jsonStringArrayPreprocess(val: unknown) {
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
}

export const jsonStringArray = z.preprocess(
  jsonStringArrayPreprocess,
  z.array(z.string().min(1).max(200)).max(20),
);

const importTagsSchema = z.preprocess(
  jsonStringArrayPreprocess,
  z.array(z.string().min(1).max(50)).max(20),
);

const importAliasesSchema = z.preprocess(
  jsonStringArrayPreprocess,
  z.array(z.string().min(1).max(200)).max(10),
);

export const importItemSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(["note", "todo", "scratch"]).default("note"),
    title: z.string().min(1).max(500),
    content: z.string().max(50000).default(""),
    status: importStatusEnum.default("fleeting"),
    priority: z.enum(["low", "medium", "high"]).nullable().default(null),
    due: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")
      .nullable()
      .default(null),
    tags: importTagsSchema.default([]),
    origin: z.string().default(""),
    source: z.string().nullable().default(null),
    aliases: importAliasesSchema.default([]),
    linked_note_id: z.string().uuid().nullable().default(null),
    category_id: z.string().uuid().nullable().default(null),
    paused: z.coerce.number().int().min(0).max(1).default(0),
    paused_at: z.string().nullable().default(null),
    paused_context: z.string().max(500).nullable().default(null),
    created: z.string().min(1),
    modified: z.string().min(1),
  })
  .refine(
    (data) =>
      data.status === "exported" ? data.type === "note" : isValidTypeStatus(data.type, data.status),
    {
      message: "Invalid status for the given type",
      path: ["status"],
    },
  );

export const importSchema = z.object({
  items: z.array(importItemSchema).max(10000),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
