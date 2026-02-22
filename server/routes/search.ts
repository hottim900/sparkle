import { Hono } from "hono";
import { sqlite } from "../db/index.js";
import { searchItems } from "../lib/items.js";
import { searchSchema } from "../schemas/items.js";
import { ZodError } from "zod";

const searchRouter = new Hono();

searchRouter.get("/", (c) => {
  try {
    const query = searchSchema.parse({
      q: c.req.query("q"),
      limit: c.req.query("limit"),
    });
    const results = searchItems(sqlite, query.q, query.limit);
    return c.json({ results });
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.errors[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

export { searchRouter };
