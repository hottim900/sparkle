import { z } from "zod";

// Root level — available on all routes
export const rootSearchSchema = z.object({
  item: z.string().optional(),
});

// List routes — filter params
export const listSearchSchema = rootSearchSchema.extend({
  tag: z.string().optional(),
  sort: z.enum(["created", "modified", "priority", "due"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  cat: z.string().optional(),
});

export type RootSearchParams = z.infer<typeof rootSearchSchema>;
export type ListSearchParams = z.infer<typeof listSearchSchema>;
