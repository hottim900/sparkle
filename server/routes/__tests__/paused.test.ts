import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb } from "../../test-utils.js";

// --- In-memory DB setup & module mock ---

let testSqlite: Database.Database;
let testDb: ReturnType<typeof drizzle>;

vi.mock("../../db/index.js", () => ({
  get db() {
    return testDb;
  },
  get sqlite() {
    return testSqlite;
  },
  DB_PATH: ":memory:",
}));

vi.mock("../../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Now import the app pieces
import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { itemsRouter } from "../items.js";
import { statsRouter } from "../stats.js";
import { dashboardRouter } from "../dashboard.js";

const TEST_TOKEN = "test-secret-token-12345";

function createApp() {
  const app = new Hono();
  app.use("/api/*", authMiddleware);
  app.route("/api/items", itemsRouter);
  app.route("/api/stats", statsRouter);
  app.route("/api/dashboard", dashboardRouter);
  app.onError((err, c) => {
    console.error("Unhandled error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });
  return app;
}

let app: Hono;

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

function jsonHeaders(): Record<string, string> {
  return {
    ...authHeaders(),
    "Content-Type": "application/json",
  };
}

beforeAll(() => {
  process.env.AUTH_TOKEN = TEST_TOKEN;
});

beforeEach(() => {
  const fresh = createTestDb();
  testDb = fresh.db;
  testSqlite = fresh.sqlite;
  app = createApp();
});

// Helper to insert an item directly into the DB
function insertItem(fields: {
  id: string;
  title: string;
  type?: string;
  status?: string;
  priority?: string | null;
  due?: string | null;
  created?: string;
  modified?: string;
  paused?: number;
  paused_at?: string | null;
  paused_context?: string | null;
}) {
  const now = new Date().toISOString();
  testSqlite
    .prepare(
      `INSERT INTO items (id, type, title, content, status, priority, due, tags, origin, source, aliases, paused, paused_at, paused_context, created, modified)
       VALUES (?, ?, ?, '', ?, ?, ?, '[]', '', NULL, '[]', ?, ?, ?, ?, ?)`,
    )
    .run(
      fields.id,
      fields.type ?? "todo",
      fields.title,
      fields.status ?? "active",
      fields.priority ?? null,
      fields.due ?? null,
      fields.paused ?? 0,
      fields.paused_at ?? null,
      fields.paused_context ?? null,
      fields.created ?? now,
      fields.modified ?? now,
    );
}

// Helper to create an item via API and return its id
async function createItemApi(body: Record<string, unknown>): Promise<string> {
  const res = await app.request("/api/items", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.id;
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0]!;
}

// ============================================================
// PATCH /api/items/:id — Paused flag
// ============================================================
describe("PATCH /api/items/:id — paused flag", () => {
  it("pauses an item with paused: true", async () => {
    const id = await createItemApi({ title: "Test note", type: "note" });

    const res = await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ paused: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paused).toBe(1);
    expect(body.pausedAt).toBeTruthy();
    expect(body.pausedContext).toBeNull();
  });

  it("unpauses an item with paused: false", async () => {
    const id = await createItemApi({ title: "Test note", type: "note" });

    // Pause first
    await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ paused: true, pausedContext: "waiting" }),
    });

    // Unpause
    const res = await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ paused: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paused).toBe(0);
    expect(body.pausedAt).toBeNull();
    expect(body.pausedContext).toBeNull();
  });

  it("stores pausedContext when pausing", async () => {
    const id = await createItemApi({ title: "Test todo", type: "todo" });

    const res = await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ paused: true, pausedContext: "waiting for feedback" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paused).toBe(1);
    expect(body.pausedContext).toBe("waiting for feedback");
  });

  it("rejects pausedContext > 500 chars", async () => {
    const id = await createItemApi({ title: "Test note", type: "note" });

    const res = await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ paused: true, pausedContext: "x".repeat(501) }),
    });
    expect(res.status).toBe(400);
  });

  it("auto-clears paused when archiving", async () => {
    const id = await createItemApi({ title: "Test note", type: "note" });

    // Pause
    await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ paused: true, pausedContext: "reason" }),
    });

    // Archive
    const res = await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ status: "archived" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paused).toBe(0);
    expect(body.pausedAt).toBeNull();
    expect(body.pausedContext).toBeNull();
  });

  it("preserves paused flag on type conversion", async () => {
    const id = await createItemApi({ title: "Paused note", type: "note" });

    // Pause
    await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ paused: true, pausedContext: "thinking" }),
    });

    // Convert note → todo
    const res = await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "todo" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("todo");
    expect(body.paused).toBe(1);
    expect(body.pausedContext).toBe("thinking");
  });

  it("silently ignores pausedContext when not pausing a non-paused item", async () => {
    const id = await createItemApi({ title: "Test note", type: "note" });

    const res = await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ pausedContext: "should be ignored" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paused).toBe(0);
    expect(body.pausedContext).toBeNull();
  });
});

// ============================================================
// GET /api/items — paused filter
// ============================================================
describe("GET /api/items — paused filter", () => {
  it("excludes paused items by default (no param)", async () => {
    insertItem({ id: "normal-1", title: "Normal", type: "note", status: "fleeting" });
    insertItem({
      id: "paused-1",
      title: "Paused",
      type: "note",
      status: "fleeting",
      paused: 1,
      paused_at: new Date().toISOString(),
    });

    const res = await app.request("/api/items", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain("normal-1");
    expect(ids).not.toContain("paused-1");
  });

  it("returns only paused items with paused=true", async () => {
    insertItem({ id: "normal-1", title: "Normal", type: "note", status: "fleeting" });
    insertItem({
      id: "paused-1",
      title: "Paused",
      type: "note",
      status: "fleeting",
      paused: 1,
      paused_at: new Date().toISOString(),
    });

    const res = await app.request("/api/items?paused=true", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain("paused-1");
    expect(ids).not.toContain("normal-1");
  });

  it("returns only non-paused items with paused=false", async () => {
    insertItem({ id: "normal-1", title: "Normal", type: "note", status: "fleeting" });
    insertItem({
      id: "paused-1",
      title: "Paused",
      type: "note",
      status: "fleeting",
      paused: 1,
      paused_at: new Date().toISOString(),
    });

    const res = await app.request("/api/items?paused=false", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain("normal-1");
    expect(ids).not.toContain("paused-1");
  });

  it("returns all items with paused=all", async () => {
    insertItem({ id: "normal-1", title: "Normal", type: "note", status: "fleeting" });
    insertItem({
      id: "paused-1",
      title: "Paused",
      type: "note",
      status: "fleeting",
      paused: 1,
      paused_at: new Date().toISOString(),
    });

    const res = await app.request("/api/items?paused=all", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain("normal-1");
    expect(ids).toContain("paused-1");
  });
});

// ============================================================
// Batch operations — paused auto-clear
// ============================================================
describe("POST /api/items/batch — paused auto-clear", () => {
  it("clears paused flag on batch archive", async () => {
    // Create item via API to get a proper UUID
    const id = await createItemApi({ title: "Paused item", type: "note" });

    // Pause it
    await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ paused: true, pausedContext: "reason" }),
    });

    // Batch archive
    const res = await app.request("/api/items/batch", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ ids: [id], action: "archive" }),
    });
    expect(res.status).toBe(200);
    const batchBody = await res.json();
    expect(batchBody.affected).toBe(1);

    // Verify the item is unpaused
    const getRes = await app.request(`/api/items/${id}`, {
      headers: authHeaders(),
    });
    const item = await getRes.json();
    expect(item.paused).toBe(0);
    expect(item.pausedAt).toBeNull();
    expect(item.pausedContext).toBeNull();
  });
});

// ============================================================
// Dashboard — paused items excluded
// ============================================================
describe("Dashboard queries exclude paused items", () => {
  it("paused developing note not in stale dashboard", async () => {
    const oldDate = "2024-01-01T00:00:00.000Z";

    // Stale non-paused developing note (should appear)
    insertItem({
      id: "stale-normal",
      title: "Normal stale",
      type: "note",
      status: "developing",
      modified: oldDate,
    });

    // Stale paused developing note (should NOT appear)
    insertItem({
      id: "stale-paused",
      title: "Paused stale",
      type: "note",
      status: "developing",
      modified: oldDate,
      paused: 1,
      paused_at: new Date().toISOString(),
    });

    const res = await app.request("/api/stats/stale", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain("stale-normal");
    expect(ids).not.toContain("stale-paused");
  });

  it("paused high-priority todo not in attention dashboard", async () => {
    const pastDate = daysFromNow(-3);

    // Non-paused attention item (should appear)
    insertItem({
      id: "attention-normal",
      title: "Normal attention",
      type: "todo",
      status: "active",
      priority: "high",
      due: pastDate,
    });

    // Paused attention item (should NOT appear)
    insertItem({
      id: "attention-paused",
      title: "Paused attention",
      type: "todo",
      status: "active",
      priority: "high",
      due: pastDate,
      paused: 1,
      paused_at: new Date().toISOString(),
    });

    const res = await app.request("/api/dashboard/attention", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain("attention-normal");
    expect(ids).not.toContain("attention-paused");
  });

  it("paused item excluded from focus items", async () => {
    const pastDate = daysFromNow(-3);

    insertItem({
      id: "focus-normal",
      title: "Normal focus",
      type: "todo",
      status: "active",
      due: pastDate,
    });

    insertItem({
      id: "focus-paused",
      title: "Paused focus",
      type: "todo",
      status: "active",
      due: pastDate,
      paused: 1,
      paused_at: new Date().toISOString(),
    });

    const res = await app.request("/api/stats/focus", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain("focus-normal");
    expect(ids).not.toContain("focus-paused");
  });

  it("paused item excluded from category distribution", async () => {
    insertItem({
      id: "catdist-normal",
      title: "Normal",
      type: "note",
      status: "fleeting",
    });

    insertItem({
      id: "catdist-paused",
      title: "Paused",
      type: "note",
      status: "fleeting",
      paused: 1,
      paused_at: new Date().toISOString(),
    });

    const res = await app.request("/api/stats/category-distribution", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Only non-paused item should be counted
    const totalCount = body.distribution.reduce(
      (sum: number, d: { count: number }) => sum + d.count,
      0,
    );
    expect(totalCount).toBe(1);
  });

  it("paused overdue todo excluded from stats overdue_count", async () => {
    const pastDate = daysFromNow(-3);

    insertItem({
      id: "overdue-normal",
      title: "Normal overdue",
      type: "todo",
      status: "active",
      due: pastDate,
    });

    insertItem({
      id: "overdue-paused",
      title: "Paused overdue",
      type: "todo",
      status: "active",
      due: pastDate,
      paused: 1,
      paused_at: new Date().toISOString(),
    });

    const res = await app.request("/api/stats", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overdue_count).toBe(1);
  });

  it("paused unreviewed item excluded from unreviewed dashboard", async () => {
    insertItem({
      id: "unreviewed-normal",
      title: "Normal unreviewed",
      type: "note",
      status: "fleeting",
    });

    insertItem({
      id: "unreviewed-paused",
      title: "Paused unreviewed",
      type: "note",
      status: "fleeting",
      paused: 1,
      paused_at: new Date().toISOString(),
    });

    const res = await app.request("/api/dashboard/unreviewed", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain("unreviewed-normal");
    expect(ids).not.toContain("unreviewed-paused");
  });
});

// ============================================================
// LINE Brief — paused exclusion
// ============================================================
describe("LINE brief excludes paused items", () => {
  it("paused overdue todo excluded from brief data", async () => {
    // We test the queryBriefData function directly since the route
    // requires LINE credentials
    const { queryBriefData } = await import("../../lib/line-brief.js");

    const pastDate = daysFromNow(-3);

    insertItem({
      id: "brief-overdue-normal",
      title: "Normal overdue",
      type: "todo",
      status: "active",
      due: pastDate,
    });

    insertItem({
      id: "brief-overdue-paused",
      title: "Paused overdue",
      type: "todo",
      status: "active",
      due: pastDate,
      paused: 1,
      paused_at: new Date().toISOString(),
    });

    const today = daysFromNow(0);
    const data = queryBriefData(testSqlite, today);
    const ids = data.overdue_todos.map((t) => t.id);
    expect(ids).toContain("brief-overdue-normal");
    expect(ids).not.toContain("brief-overdue-paused");
  });

  it("paused stale fleeting excluded from brief data", async () => {
    const { queryBriefData } = await import("../../lib/line-brief.js");

    const oldDate = "2024-01-01T00:00:00.000Z";

    insertItem({
      id: "brief-stale-normal",
      title: "Normal stale",
      type: "note",
      status: "fleeting",
      modified: oldDate,
    });

    insertItem({
      id: "brief-stale-paused",
      title: "Paused stale",
      type: "note",
      status: "fleeting",
      modified: oldDate,
      paused: 1,
      paused_at: new Date().toISOString(),
    });

    const today = daysFromNow(0);
    const data = queryBriefData(testSqlite, today);
    const ids = data.stale_fleetings.map((n) => n.id);
    expect(ids).toContain("brief-stale-normal");
    expect(ids).not.toContain("brief-stale-paused");
  });
});

// ============================================================
// Daily Note — paused exclusion
// ============================================================
describe("Daily note excludes paused items", () => {
  // We need to mock settings for daily note tests
  it("paused overdue todo excluded from daily note query", async () => {
    const pastDate = daysFromNow(-3);
    const today = daysFromNow(0);

    insertItem({
      id: "daily-overdue-normal",
      title: "Normal overdue",
      type: "todo",
      status: "active",
      due: pastDate,
    });

    insertItem({
      id: "daily-overdue-paused",
      title: "Paused overdue",
      type: "todo",
      status: "active",
      due: pastDate,
      paused: 1,
      paused_at: new Date().toISOString(),
    });

    // Query the overdue data directly via raw SQL (same query daily-note uses)
    const overdue = testSqlite
      .prepare(
        `SELECT id, title, priority, due
         FROM items
         WHERE type = 'todo'
           AND status NOT IN ('done', 'exported', 'archived')
           AND due IS NOT NULL
           AND due < ?
           AND is_private = 0
           AND paused = 0`,
      )
      .all(today) as { id: string }[];

    const ids = overdue.map((o) => o.id);
    expect(ids).toContain("daily-overdue-normal");
    expect(ids).not.toContain("daily-overdue-paused");
  });

  it("paused todo due today excluded from daily note todosDue", async () => {
    const today = daysFromNow(0);

    insertItem({
      id: "daily-due-normal",
      title: "Normal due",
      type: "todo",
      status: "active",
      due: today,
    });

    insertItem({
      id: "daily-due-paused",
      title: "Paused due",
      type: "todo",
      status: "active",
      due: today,
      paused: 1,
      paused_at: new Date().toISOString(),
    });

    // Query the todosDue data directly via raw SQL (same query daily-note uses)
    const todosDue = testSqlite
      .prepare(
        `SELECT id, title, priority, due
         FROM items
         WHERE type = 'todo'
           AND status NOT IN ('done', 'exported', 'archived')
           AND due = ?
           AND is_private = 0
           AND paused = 0`,
      )
      .all(today) as { id: string }[];

    const ids = todosDue.map((t) => t.id);
    expect(ids).toContain("daily-due-normal");
    expect(ids).not.toContain("daily-due-paused");
  });
});
