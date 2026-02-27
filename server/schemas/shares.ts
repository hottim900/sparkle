import { z } from "zod";

export const createShareSchema = z.object({
  visibility: z.enum(["unlisted", "public"]).default("unlisted"),
});
