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
      status TEXT NOT NULL DEFAULT 'inbox',
      priority TEXT,
      due_date TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_items_status ON items(status);
    CREATE INDEX idx_items_type ON items(type);
    CREATE INDEX idx_items_created_at ON items(created_at DESC);
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

// Now import the app (which imports routes that import the mocked db)
import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { itemsRouter } from "../items.js";
import { searchRouter } from "../search.js";
import { getAllTags } from "../../lib/items.js";

const TEST_TOKEN = "test-secret-token-12345";

function createApp() {
  const app = new Hono();
  app.use("/api/*", authMiddleware);
  app.route("/api/items", itemsRouter);
  app.route("/api/search", searchRouter);
  app.get("/api/tags", (c) => {
    const tags = getAllTags(testSqlite);
    return c.json({ tags });
  });
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

// ============================================================
// Auth Middleware Tests
// ============================================================
describe("Auth middleware", () => {
  it("returns 401 when no Authorization header", async () => {
    const res = await app.request("/api/items");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Missing Authorization/i);
  });

  it("returns 401 when invalid token", async () => {
    const res = await app.request("/api/items", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid token/i);
  });

  it("returns 401 for malformed Authorization header", async () => {
    const res = await app.request("/api/items", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid Authorization format/i);
  });

  it("returns 200 with valid Bearer token", async () => {
    const res = await app.request("/api/items", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================
// Items CRUD Tests
// ============================================================
describe("Items CRUD", () => {
  describe("POST /api/items", () => {
    it("creates an item and returns 201", async () => {
      const res = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Buy groceries" }),
      });
      expect(res.status).toBe(201);
      const item = await res.json();
      expect(item.title).toBe("Buy groceries");
      expect(item.id).toBeTruthy();
      expect(item.status).toBe("inbox");
      expect(item.type).toBe("note");
    });

    it("creates an item with all fields", async () => {
      const res = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          title: "Finish report",
          type: "todo",
          content: "Q4 report for the team",
          status: "active",
          priority: "high",
          due_date: "2026-03-01",
          tags: ["work", "urgent"],
          source: "email",
        }),
      });
      expect(res.status).toBe(201);
      const item = await res.json();
      expect(item.type).toBe("todo");
      expect(item.status).toBe("active");
      expect(item.priority).toBe("high");
      expect(item.due_date).toBe("2026-03-01");
      expect(JSON.parse(item.tags)).toEqual(["work", "urgent"]);
    });

    it("returns 400 when title is missing", async () => {
      const res = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/items", () => {
    it("returns list of items", async () => {
      // Create two items
      await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Item 1" }),
      });
      await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Item 2" }),
      });

      const res = await app.request("/api/items", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it("filters by status", async () => {
      await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Inbox item" }),
      });
      await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Active item", status: "active" }),
      });

      const res = await app.request("/api/items?status=inbox", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].title).toBe("Inbox item");
    });

    it("sorts items by priority descending", async () => {
      await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Low", priority: "low" }),
      });
      await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "High", priority: "high" }),
      });

      const res = await app.request(
        "/api/items?sort=priority&order=desc",
        { headers: authHeaders() },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toHaveLength(2);
      // "low" > "high" lexicographically in desc order
      expect(body.items[0].priority).toBe("low");
      expect(body.items[1].priority).toBe("high");
    });
  });

  describe("GET /api/items/:id", () => {
    it("returns a single item", async () => {
      const createRes = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Find me" }),
      });
      const created = await createRes.json();

      const res = await app.request(`/api/items/${created.id}`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const item = await res.json();
      expect(item.title).toBe("Find me");
      expect(item.id).toBe(created.id);
    });

    it("returns 404 for nonexistent id", async () => {
      const res = await app.request("/api/items/nonexistent-id-123", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/not found/i);
    });
  });

  describe("PATCH /api/items/:id", () => {
    it("updates an item", async () => {
      const createRes = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Original" }),
      });
      const created = await createRes.json();

      const res = await app.request(`/api/items/${created.id}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Updated", status: "active" }),
      });
      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.title).toBe("Updated");
      expect(updated.status).toBe("active");
    });

    it("returns 404 for nonexistent id", async () => {
      const res = await app.request("/api/items/nonexistent-id-123", {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Nope" }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/items/:id", () => {
    it("deletes an item", async () => {
      const createRes = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Delete me" }),
      });
      const created = await createRes.json();

      const res = await app.request(`/api/items/${created.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      // Verify it's gone
      const getRes = await app.request(`/api/items/${created.id}`, {
        headers: authHeaders(),
      });
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for nonexistent id", async () => {
      const res = await app.request("/api/items/nonexistent-id-123", {
        method: "DELETE",
        headers: authHeaders(),
      });
      expect(res.status).toBe(404);
    });
  });
});

// ============================================================
// Search Tests
// ============================================================
describe("Search", () => {
  it("GET /api/search?q=keyword returns matching items", async () => {
    await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Meeting notes for project Alpha",
        content: "Discuss roadmap and deadlines",
      }),
    });
    await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "Grocery list" }),
    });

    const res = await app.request("/api/search?q=Alpha", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].title).toBe("Meeting notes for project Alpha");
  });

  it("returns empty results for no matches", async () => {
    await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "Something" }),
    });

    const res = await app.request("/api/search?q=nonexistent", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(0);
  });

  it("returns 400 when q is missing", async () => {
    const res = await app.request("/api/search", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
  });
});
