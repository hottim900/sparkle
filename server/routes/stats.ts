import { Hono } from "hono";
import { sqlite } from "../db/index.js";
import { getStats, getFocusItems } from "../lib/stats.js";

const statsRouter = new Hono();

statsRouter.get("/", (c) => {
  const stats = getStats(sqlite);
  return c.json(stats);
});

statsRouter.get("/focus", (c) => {
  const items = getFocusItems(sqlite);
  return c.json({ items });
});

export { statsRouter };
