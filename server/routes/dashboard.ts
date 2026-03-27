import { Hono } from "hono";
import { sqlite } from "../db/index.js";
import { getDashboardSettings } from "../lib/settings.js";
import {
  getUnreviewedItems,
  getRecentItems,
  getAttentionItems,
  getStaleNotes,
  getWeekData,
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

// GET /api/dashboard/week?start=YYYY-MM-DD
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

dashboardRouter.get("/week", (c) => {
  const start = c.req.query("start");

  if (!start || !DATE_RE.test(start)) {
    return c.json({ error: "start must be a valid YYYY-MM-DD date" }, 400);
  }

  // Validate it's a real date and a Monday (ISO week start)
  const [y, m, d] = start.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  if (date.getFullYear() !== y || date.getMonth() !== m! - 1 || date.getDate() !== d) {
    return c.json({ error: "start must be a valid date" }, 400);
  }

  if (date.getDay() !== 1) {
    return c.json({ error: "start must be a Monday (ISO week start)" }, 400);
  }

  const result = getWeekData(sqlite, start);
  return c.json(result);
});

export { dashboardRouter };
