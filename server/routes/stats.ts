import { Hono } from "hono";
import { sqlite } from "../db/index.js";
import { getStats, getFocusItems, getStaleNotes, getCategoryDistribution } from "../lib/stats.js";

const statsRouter = new Hono();

statsRouter.get("/", (c) => {
  const stats = getStats(sqlite);
  return c.json(stats);
});

statsRouter.get("/stale", (c) => {
  const result = getStaleNotes(sqlite);
  return c.json(result);
});

statsRouter.get("/category-distribution", (c) => {
  const distribution = getCategoryDistribution(sqlite);
  return c.json({ distribution });
});

statsRouter.get("/focus", (c) => {
  const items = getFocusItems(sqlite);
  return c.json({ items });
});

export { statsRouter };
