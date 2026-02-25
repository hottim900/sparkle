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

// Now import the app (which imports routes that import the mocked db)
import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { itemsRouter } from "../items.js";
import { searchRouter } from "../search.js";
import { getAllTags } from "../../lib/items.js";
import { items } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { z, ZodError } from "zod";
import { statusEnum } from "../../schemas/items.js";

const TEST_TOKEN = "test-secret-token-12345";

const importItemSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["note", "todo"]).default("note"),
  title: z.string().min(1).max(500),
  content: z.string().default(""),
  status: statusEnum.default("fleeting"),
  priority: z.enum(["low", "medium", "high"]).nullable().default(null),
  due: z.string().nullable().default(null),
  tags: z.string().default("[]"),
  origin: z.string().default(""),
  source: z.string().nullable().default(null),
  aliases: z.string().default("[]"),
  created: z.string().min(1),
  modified: z.string().min(1),
});

const importSchema = z.object({
  items: z.array(importItemSchema),
});

function createApp() {
  const app = new Hono();
  app.use("/api/*", authMiddleware);
  app.route("/api/items", itemsRouter);
  app.route("/api/search", searchRouter);
  app.get("/api/tags", (c) => {
    const tags = getAllTags(testSqlite);
    return c.json({ tags });
  });

  // Export all items
  app.get("/api/export", (c) => {
    const allItems = testDb.select().from(items).all();
    return c.json({
      version: 2,
      exported_at: new Date().toISOString(),
      items: allItems,
    });
  });

  // Import items (upsert)
  app.post("/api/import", async (c) => {
    try {
      const body = await c.req.json();
      const { items: importItems } = importSchema.parse(body);

      let imported = 0;
      let updated = 0;

      for (const item of importItems) {
        const existing = testDb
          .select()
          .from(items)
          .where(eq(items.id, item.id))
          .get();

        if (existing) {
          testDb
            .update(items)
            .set({
              type: item.type,
              title: item.title,
              content: item.content,
              status: item.status,
              priority: item.priority,
              due: item.due,
              tags: item.tags,
              origin: item.origin,
              source: item.source,
              aliases: item.aliases,
              created: item.created,
              modified: item.modified,
            })
            .where(eq(items.id, item.id))
            .run();
          updated++;
        } else {
          testDb.insert(items).values(item).run();
          imported++;
        }
      }

      return c.json({ imported, updated });
    } catch (e) {
      if (e instanceof ZodError) {
        return c.json(
          { error: e.errors[0]?.message ?? "Validation error" },
          400,
        );
      }
      throw e;
    }
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
      expect(item.status).toBe("fleeting");
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
          due: "2026-03-01",
          tags: ["work", "urgent"],
          origin: "email",
        }),
      });
      expect(res.status).toBe(201);
      const item = await res.json();
      expect(item.type).toBe("todo");
      expect(item.status).toBe("active");
      expect(item.priority).toBe("high");
      expect(item.due).toBe("2026-03-01");
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
        body: JSON.stringify({ title: "Fleeting item" }),
      });
      await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Active item", type: "todo", status: "active" }),
      });

      const res = await app.request("/api/items?status=fleeting", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].title).toBe("Fleeting item");
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
        body: JSON.stringify({ title: "Updated", status: "developing" }),
      });
      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.title).toBe("Updated");
      expect(updated.status).toBe("developing");
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

// ============================================================
// Batch Operations Tests
// ============================================================
describe("POST /api/items/batch", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.request("/api/items/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [], action: "archive" }),
    });
    expect(res.status).toBe(401);
  });

  it("batch archive updates status to archived", async () => {
    // Create 3 items
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: `Batch item ${i}` }),
      });
      const item = await res.json();
      ids.push(item.id);
    }

    const res = await app.request("/api/items/batch", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ ids, action: "archive" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(3);

    // Verify each item is archived
    for (const id of ids) {
      const getRes = await app.request(`/api/items/${id}`, {
        headers: authHeaders(),
      });
      const item = await getRes.json();
      expect(item.status).toBe("archived");
    }
  });

  it("batch done updates status to done", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: `Done item ${i}`, type: "todo" }),
      });
      const item = await res.json();
      ids.push(item.id);
    }

    const res = await app.request("/api/items/batch", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ ids, action: "done" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(2);

    for (const id of ids) {
      const getRes = await app.request(`/api/items/${id}`, {
        headers: authHeaders(),
      });
      const item = await getRes.json();
      expect(item.status).toBe("done");
    }
  });

  it("batch active updates status to active", async () => {
    // Create items with archived status (must be todo type for active action)
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: `Active item ${i}`, type: "todo", status: "archived" }),
      });
      const item = await res.json();
      ids.push(item.id);
    }

    const res = await app.request("/api/items/batch", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ ids, action: "active" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(2);

    for (const id of ids) {
      const getRes = await app.request(`/api/items/${id}`, {
        headers: authHeaders(),
      });
      const item = await getRes.json();
      expect(item.status).toBe("active");
    }
  });

  it("batch delete removes items", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: `Delete item ${i}` }),
      });
      const item = await res.json();
      ids.push(item.id);
    }

    const res = await app.request("/api/items/batch", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ ids, action: "delete" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(2);

    // Verify items are deleted
    for (const id of ids) {
      const getRes = await app.request(`/api/items/${id}`, {
        headers: authHeaders(),
      });
      expect(getRes.status).toBe(404);
    }
  });

  it("returns 400 for invalid action", async () => {
    const res = await app.request("/api/items/batch", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        ids: ["550e8400-e29b-41d4-a716-446655440000"],
        action: "invalid",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty ids array", async () => {
    const res = await app.request("/api/items/batch", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ ids: [], action: "archive" }),
    });
    expect(res.status).toBe(400);
  });
});

// ============================================================
// Export Tests
// ============================================================
describe("GET /api/export", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.request("/api/export");
    expect(res.status).toBe(401);
  });

  it("exports correct format with empty database", async () => {
    const res = await app.request("/api/export", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(2);
    expect(body.exported_at).toBeTruthy();
    expect(body.items).toEqual([]);
  });

  it("exports all items", async () => {
    await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "Export item 1" }),
    });
    await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "Export item 2", type: "todo", status: "active" }),
    });

    const res = await app.request("/api/export", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(2);
    expect(body.exported_at).toBeTruthy();
    expect(body.items).toHaveLength(2);
    const titles = body.items.map((i: { title: string }) => i.title).sort();
    expect(titles).toEqual(["Export item 1", "Export item 2"]);
  });
});

// ============================================================
// Import Tests
// ============================================================
describe("POST /api/import", () => {
  it("returns 401 when no auth", async () => {
    const res = await app.request("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [] }),
    });
    expect(res.status).toBe(401);
  });

  it("imports new items", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440001",
            title: "Imported item 1",
            type: "note",
            content: "",
            status: "fleeting",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            created: now,
            modified: now,
          },
          {
            id: "550e8400-e29b-41d4-a716-446655440002",
            title: "Imported item 2",
            type: "todo",
            content: "Some content",
            status: "active",
            priority: "high",
            due: null,
            tags: '["work"]',
            origin: "",
            source: null,
            aliases: "[]",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(2);
    expect(body.updated).toBe(0);

    // Verify items exist
    const getRes = await app.request(
      "/api/items/550e8400-e29b-41d4-a716-446655440001",
      { headers: authHeaders() },
    );
    expect(getRes.status).toBe(200);
    const item = await getRes.json();
    expect(item.title).toBe("Imported item 1");
  });

  it("upserts existing items", async () => {
    const now = new Date().toISOString();
    // First import
    await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440003",
            title: "Original title",
            type: "note",
            content: "",
            status: "fleeting",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            created: now,
            modified: now,
          },
        ],
      }),
    });

    // Second import with same id but updated title
    const laterNow = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440003",
            title: "Updated title",
            type: "todo",
            content: "Updated content",
            status: "active",
            priority: "high",
            due: null,
            tags: '["updated"]',
            origin: "",
            source: null,
            aliases: "[]",
            created: now,
            modified: laterNow,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(0);
    expect(body.updated).toBe(1);

    // Verify item was updated
    const getRes = await app.request(
      "/api/items/550e8400-e29b-41d4-a716-446655440003",
      { headers: authHeaders() },
    );
    const item = await getRes.json();
    expect(item.title).toBe("Updated title");
    expect(item.status).toBe("active");
  });

  it("returns 400 for invalid data format", async () => {
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ items: [{ invalid: "data" }] }),
    });
    expect(res.status).toBe(400);
  });
});
