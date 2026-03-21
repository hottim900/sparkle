import { Hono } from "hono";
import { sqlite } from "../db/index.js";
import { getDashboardSettings } from "../lib/settings.js";
import {
  getUnreviewedItems,
  getRecentItems,
  getAttentionItems,
  getStaleNotes,
} from "../lib/stats.js";

const dashboardRouter = new Hono();

// GET /api/dashboard/unreviewed
dashboardRouter.get("/unreviewed", (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "5", 10) || 5, 1), 100);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
  const result = getUnreviewedItems(sqlite, limit, offset);
  return c.json(result);
});

// GET /api/dashboard/recent
dashboardRouter.get("/recent", (c) => {
  const { recentDays } = getDashboardSettings(sqlite);
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "5", 10) || 5, 1), 100);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
  const result = getRecentItems(sqlite, recentDays, limit, offset);
  return c.json(result);
});

// GET /api/dashboard/attention
dashboardRouter.get("/attention", (c) => {
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "5", 10) || 5, 1), 100);
  const result = getAttentionItems(sqlite, limit);
  return c.json(result);
});

// GET /api/dashboard/stale
dashboardRouter.get("/stale", (c) => {
  const { staleDays } = getDashboardSettings(sqlite);
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "10", 10) || 10, 1), 100);
  const result = getStaleNotes(sqlite, staleDays, limit);
  return c.json(result);
});

export { dashboardRouter };
