import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { setupFTS } from "../../db/fts.js";

// --- In-memory DB setup & module mock ---

let testSqlite: Database.Database;
let testDb: ReturnType<typeof drizzle>;

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");

  sqlite.exec(`
    CREATE TABLE items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'note',
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'fleeting',
      priority TEXT,
      due TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      origin TEXT DEFAULT '',
      source TEXT DEFAULT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );
    CREATE INDEX idx_items_status ON items(status);
    CREATE INDEX idx_items_type ON items(type);
    CREATE INDEX idx_items_created ON items(created DESC);
  `);

  setupFTS(sqlite);

  return { db: drizzle(sqlite, { schema }), sqlite };
}

// Mock the db module so route files import our in-memory DB
vi.mock("../../db/index.js", () => ({
  get db() {
    return testDb;
  },
  get sqlite() {
    return testSqlite;
  },
  DB_PATH: ":memory:",
}));

// Now import the app pieces (which import routes that import the mocked db)
import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { statsRouter } from "../stats.js";

const TEST_TOKEN = "test-secret-token-12345";

function createApp() {
  const app = new Hono();
  app.use("/api/*", authMiddleware);
  app.route("/api/stats", statsRouter);
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
}) {
  const now = new Date().toISOString();
  testSqlite
    .prepare(
      `INSERT INTO items (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified)
       VALUES (?, ?, ?, '', ?, ?, ?, '[]', '', NULL, '[]', ?, ?)`,
    )
    .run(
      fields.id,
      fields.type ?? "todo",
      fields.title,
      fields.status ?? "active",
      fields.priority ?? null,
      fields.due ?? null,
      fields.created ?? now,
      fields.modified ?? now,
    );
}

// Helper to get dates relative to today for testing
function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// Helper: get the Monday of the current ISO week
function getThisWeekMonday(): Date {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// ============================================================
// GET /api/stats Tests
// ============================================================
describe("GET /api/stats", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/stats");
    expect(res.status).toBe(401);
  });

  it("returns zeros for empty database", async () => {
    const res = await app.request("/api/stats", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      fleeting_count: 0,
      developing_count: 0,
      permanent_count: 0,
      exported_this_week: 0,
      exported_this_month: 0,
      active_count: 0,
      done_this_week: 0,
      done_this_month: 0,
      created_this_week: 0,
      created_this_month: 0,
      overdue_count: 0,
    });
  });

  it("counts fleeting and active items correctly", async () => {
    insertItem({ id: "i1", title: "Fleeting 1", type: "note", status: "fleeting" });
    insertItem({ id: "i2", title: "Fleeting 2", type: "note", status: "fleeting" });
    insertItem({ id: "a1", title: "Active 1", status: "active" });
    insertItem({ id: "a2", title: "Active 2", status: "active" });
    insertItem({ id: "a3", title: "Active 3", status: "active" });
    insertItem({ id: "d1", title: "Done 1", status: "done" });
    insertItem({ id: "ar1", title: "Archived 1", status: "archived" });

    const res = await app.request("/api/stats", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fleeting_count).toBe(2);
    expect(body.active_count).toBe(3);
  });

  it("counts overdue items (active todos with past due) but NOT done items with past due", async () => {
    const pastDate = daysFromNow(-3);
    const futureDate = daysFromNow(5);

    // These SHOULD be overdue
    insertItem({
      id: "o1",
      title: "Overdue active",
      status: "active",
      due: pastDate,
    });

    // These should NOT be overdue
    insertItem({
      id: "nd1",
      title: "Done with past date",
      status: "done",
      due: pastDate,
    });
    insertItem({
      id: "nd2",
      title: "Archived with past date",
      status: "archived",
      due: pastDate,
    });
    insertItem({
      id: "nd3",
      title: "Active with future date",
      status: "active",
      due: futureDate,
    });
    insertItem({
      id: "nd4",
      title: "Active with no due date",
      status: "active",
    });

    const res = await app.request("/api/stats", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overdue_count).toBe(1);
  });

  it("does not count notes with past due as overdue", async () => {
    const pastDate = daysFromNow(-3);

    insertItem({
      id: "note-overdue",
      title: "Note with past due",
      type: "note",
      status: "fleeting",
      due: pastDate,
    });

    const res = await app.request("/api/stats", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overdue_count).toBe(0);
  });

  it("counts done and created items this week and this month", async () => {
    const now = new Date();
    const today = now.toISOString();

    // Item created and done this week (should count for both week and month)
    insertItem({
      id: "cw1",
      title: "Done this week",
      status: "done",
      created: today,
      modified: today,
    });

    // Item created this week, still active
    insertItem({
      id: "cr1",
      title: "Created this week",
      status: "active",
      created: today,
      modified: today,
    });

    // Item created long ago, should NOT count for this week or month
    const oldDate = "2024-01-15T00:00:00.000Z";
    insertItem({
      id: "old1",
      title: "Old item",
      status: "done",
      created: oldDate,
      modified: oldDate,
    });

    const res = await app.request("/api/stats", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // At minimum, items created today count for this week and month
    expect(body.created_this_week).toBeGreaterThanOrEqual(2);
    expect(body.created_this_month).toBeGreaterThanOrEqual(2);
    expect(body.done_this_week).toBeGreaterThanOrEqual(1);
    expect(body.done_this_month).toBeGreaterThanOrEqual(1);
  });

  it("counts developing notes correctly", async () => {
    insertItem({ id: "dev1", title: "Developing 1", type: "note", status: "developing" });
    insertItem({ id: "dev2", title: "Developing 2", type: "note", status: "developing" });
    insertItem({ id: "fl1", title: "Fleeting 1", type: "note", status: "fleeting" });

    const res = await app.request("/api/stats", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.developing_count).toBe(2);
  });

  it("counts exported items this week and month", async () => {
    const today = new Date().toISOString();
    insertItem({
      id: "exp1",
      title: "Exported 1",
      type: "note",
      status: "exported",
      created: today,
      modified: today,
    });
    insertItem({
      id: "exp2",
      title: "Exported 2",
      type: "note",
      status: "exported",
      created: today,
      modified: today,
    });

    const res = await app.request("/api/stats", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exported_this_week).toBeGreaterThanOrEqual(2);
    expect(body.exported_this_month).toBeGreaterThanOrEqual(2);
  });

  it("overdue excludes exported items", async () => {
    const pastDate = daysFromNow(-3);
    insertItem({
      id: "exp-overdue",
      title: "Exported with past due",
      type: "note",
      status: "exported",
      due: pastDate,
    });

    const res = await app.request("/api/stats", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.overdue_count).toBe(0);
  });
});

// ============================================================
// GET /api/stats/focus Tests
// ============================================================
describe("GET /api/stats/focus", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/stats/focus");
    expect(res.status).toBe(401);
  });

  it("returns empty array when no items", async () => {
    const res = await app.request("/api/stats/focus", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });

  it("prioritizes overdue items first", async () => {
    const pastDate = daysFromNow(-5);
    const futureDate = daysFromNow(3);

    // Overdue item (should appear first)
    insertItem({
      id: "overdue1",
      title: "Overdue task",
      status: "active",
      due: pastDate,
      priority: "low",
    });

    // Due soon item (should appear after overdue)
    insertItem({
      id: "soon1",
      title: "Due soon task",
      status: "active",
      due: futureDate,
      priority: "high",
    });

    // High priority no due date (should appear after due-soon)
    insertItem({
      id: "high1",
      title: "High priority task",
      status: "active",
      priority: "high",
    });

    const res = await app.request("/api/stats/focus", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.items.length).toBeGreaterThanOrEqual(1);
    expect(body.items[0].id).toBe("overdue1");
  });

  it("does not give notes due-based focus ranks", async () => {
    const pastDate = daysFromNow(-5);

    // Note with overdue due date (legacy data) — should NOT get rank 1
    insertItem({
      id: "note-with-due",
      title: "Note with overdue",
      type: "note",
      status: "fleeting",
      due: pastDate,
    });

    // Todo with overdue due date — should get rank 1
    insertItem({
      id: "todo-overdue",
      title: "Overdue todo",
      status: "active",
      due: pastDate,
    });

    const res = await app.request("/api/stats/focus", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    // Todo should appear first (rank 1: overdue todo)
    expect(body.items[0].id).toBe("todo-overdue");

    // Note enters via rank 5 (fleeting), not rank 1 (overdue)
    const todoIdx = body.items.findIndex((i: { id: string }) => i.id === "todo-overdue");
    const noteIdx = body.items.findIndex((i: { id: string }) => i.id === "note-with-due");
    expect(noteIdx).toBeGreaterThan(todoIdx);
  });

  it("returns at most 5 items", async () => {
    // Insert 8 active items with due dates
    for (let i = 0; i < 8; i++) {
      insertItem({
        id: `item-${i}`,
        title: `Task ${i}`,
        status: "active",
        due: daysFromNow(-i),
        priority: "high",
      });
    }

    const res = await app.request("/api/stats/focus", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBe(5);
  });
});
