import { z } from "zod";

export const createItemSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  type: z.enum(["note", "todo"]).default("note"),
  content: z.string().max(50000).default(""),
  status: z.enum(["inbox", "active", "done", "archived"]).default("inbox"),
  priority: z.enum(["low", "medium", "high"]).nullable().default(null),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")
    .nullable()
    .default(null),
  tags: z.array(z.string().max(50)).max(20).default([]),
  source: z.string().max(200).default(""),
});

export const updateItemSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  type: z.enum(["note", "todo"]).optional(),
  content: z.string().max(50000).optional(),
  status: z.enum(["inbox", "active", "done", "archived"]).optional(),
  priority: z.enum(["low", "medium", "high"]).nullable().optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")
    .nullable()
    .optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  source: z.string().max(200).optional(),
});

export const listItemsSchema = z.object({
  status: z.enum(["inbox", "active", "done", "archived"]).optional(),
  type: z.enum(["note", "todo"]).optional(),
  tag: z.string().optional(),
  sort: z.enum(["created_at", "priority", "due_date"]).default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const batchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "At least one id is required"),
  action: z.enum(["archive", "done", "active", "delete"]),
});

export const searchSchema = z.object({
  q: z.string().min(1, "Search query is required"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
