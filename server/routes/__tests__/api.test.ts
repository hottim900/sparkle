import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from "vitest";
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
      linked_note_id TEXT DEFAULT NULL,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );
    CREATE INDEX idx_items_status ON items(status);
    CREATE INDEX idx_items_type ON items(type);
    CREATE INDEX idx_items_created ON items(created DESC);

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT INTO settings (key, value) VALUES
      ('obsidian_enabled', 'false'),
      ('obsidian_vault_path', ''),
      ('obsidian_inbox_folder', '0_Inbox'),
      ('obsidian_export_mode', 'overwrite');
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
import { settingsRouter } from "../settings.js";
import { getAllTags } from "../../lib/items.js";
import { getObsidianSettings } from "../../lib/settings.js";
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
  app.route("/api/settings", settingsRouter);
  app.get("/api/tags", (c) => {
    const tags = getAllTags(testSqlite);
    return c.json({ tags });
  });

  app.get("/api/config", (c) => {
    const obsidian = getObsidianSettings(testSqlite);
    return c.json({
      obsidian_export_enabled: obsidian.obsidian_enabled && !!obsidian.obsidian_vault_path,
    });
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
  const OLD_FIELD_NAMES = ["due_date", "created_at", "updated_at"];

  app.post("/api/import", async (c) => {
    try {
      const body = await c.req.json();

      // Check for old format fields
      if (body.items && Array.isArray(body.items) && body.items.length > 0) {
        const sample = body.items[0];
        for (const oldField of OLD_FIELD_NAMES) {
          if (oldField in sample) {
            return c.json(
              { error: "Unrecognized field names — please re-export from current version" },
              400,
            );
          }
        }
        // Also check for old status values
        if (sample.status === "inbox") {
          return c.json(
            { error: "Unrecognized field names — please re-export from current version" },
            400,
          );
        }
      }

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

    describe("type-status validation", () => {
      it("returns 400 creating todo with status=fleeting", async () => {
        const res = await app.request("/api/items", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ title: "Bad todo", type: "todo", status: "fleeting" }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/Invalid status/i);
      });

      it("returns 400 creating note with status=active", async () => {
        const res = await app.request("/api/items", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ title: "Bad note", type: "note", status: "active" }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/Invalid status/i);
      });
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

    it("sorts items by modified descending", async () => {
      const res1 = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "First" }),
      });
      const item1 = await res1.json();

      const res2 = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Second" }),
      });
      await res2.json();

      // Update first item so it has a newer modified timestamp
      await new Promise((r) => setTimeout(r, 5));
      await app.request(`/api/items/${item1.id}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "First Updated" }),
      });

      const res = await app.request(
        "/api/items?sort=modified&order=desc",
        { headers: authHeaders() },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toHaveLength(2);
      expect(body.items[0].title).toBe("First Updated");
      expect(body.items[1].title).toBe("Second");
    });

    it("returns linked_note_title in list response", async () => {
      const noteRes = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "My Reference Note", type: "note" }),
      });
      const note = await noteRes.json();

      await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          title: "Linked Todo",
          type: "todo",
          linked_note_id: note.id,
        }),
      });

      await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Plain Todo", type: "todo" }),
      });

      const res = await app.request("/api/items?type=todo", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const linked = body.items.find((i: { title: string }) => i.title === "Linked Todo");
      const plain = body.items.find((i: { title: string }) => i.title === "Plain Todo");
      expect(linked.linked_note_title).toBe("My Reference Note");
      expect(plain.linked_note_title).toBeNull();
    });

    it("returns linked_todo_count in list response for notes", async () => {
      const noteRes = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Note With Todos", type: "note" }),
      });
      const note = await noteRes.json();

      await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Note Without Todos", type: "note" }),
      });

      await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          title: "Linked Todo 1",
          type: "todo",
          linked_note_id: note.id,
        }),
      });

      await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          title: "Linked Todo 2",
          type: "todo",
          linked_note_id: note.id,
        }),
      });

      const res = await app.request("/api/items?type=note", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      const withTodos = body.items.find((i: { title: string }) => i.title === "Note With Todos");
      const withoutTodos = body.items.find((i: { title: string }) => i.title === "Note Without Todos");
      expect(withTodos.linked_todo_count).toBe(2);
      expect(withoutTodos.linked_todo_count).toBe(0);
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

    it("returns linked_todo_count for a single note", async () => {
      const noteRes = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "My Note", type: "note" }),
      });
      const note = await noteRes.json();

      await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          title: "Linked Todo",
          type: "todo",
          linked_note_id: note.id,
        }),
      });

      const res = await app.request(`/api/items/${note.id}`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const item = await res.json();
      expect(item.linked_todo_count).toBe(1);
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

    describe("type-status validation", () => {
      it("returns 400 updating note to status=active", async () => {
        const createRes = await app.request("/api/items", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ title: "A note" }),
        });
        const created = await createRes.json();

        const res = await app.request(`/api/items/${created.id}`, {
          method: "PATCH",
          headers: jsonHeaders(),
          body: JSON.stringify({ status: "active" }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/Invalid status/i);
      });

      it("returns 400 updating todo to status=fleeting", async () => {
        const createRes = await app.request("/api/items", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ title: "A todo", type: "todo" }),
        });
        const created = await createRes.json();

        const res = await app.request(`/api/items/${created.id}`, {
          method: "PATCH",
          headers: jsonHeaders(),
          body: JSON.stringify({ status: "fleeting" }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/Invalid status/i);
      });
    });

    it("ignores due field when updating a note", async () => {
      const createRes = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "A note", type: "note" }),
      });
      const created = await createRes.json();
      expect(created.due).toBeNull();

      const res = await app.request(`/api/items/${created.id}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ due: "2026-03-15" }),
      });
      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.due).toBeNull();
    });

    describe("auto-mapping override", () => {
      it("type conversion auto-mapping overrides explicit status", async () => {
        const createRes = await app.request("/api/items", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ title: "Fleeting note" }),
        });
        const created = await createRes.json();
        expect(created.status).toBe("fleeting");

        const res = await app.request(`/api/items/${created.id}`, {
          method: "PATCH",
          headers: jsonHeaders(),
          body: JSON.stringify({ type: "todo", status: "done" }),
        });
        expect(res.status).toBe(200);
        const updated = await res.json();
        expect(updated.type).toBe("todo");
        expect(updated.status).toBe("active");
      });
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
// Linked Todos Tests
// ============================================================
describe("Linked Todos", () => {
  it("POST create todo with linked_note_id saves the field", async () => {
    // Create a note first
    const noteRes = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "My note", type: "note" }),
    });
    const note = await noteRes.json();

    // Create a todo linked to the note
    const todoRes = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Track note",
        type: "todo",
        linked_note_id: note.id,
      }),
    });
    expect(todoRes.status).toBe(201);
    const todo = await todoRes.json();
    expect(todo.linked_note_id).toBe(note.id);
  });

  it("GET /api/items/:id/linked-todos returns linked todos", async () => {
    // Create a note
    const noteRes = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "My note", type: "note" }),
    });
    const note = await noteRes.json();

    // Create two linked todos
    await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Track 1",
        type: "todo",
        linked_note_id: note.id,
      }),
    });
    await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Track 2",
        type: "todo",
        linked_note_id: note.id,
      }),
    });

    const res = await app.request(`/api/items/${note.id}/linked-todos`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items.map((i: { title: string }) => i.title).sort()).toEqual(["Track 1", "Track 2"]);
  });

  it("GET /api/items/:id/linked-todos returns empty when no linked todos", async () => {
    const noteRes = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "Lonely note", type: "note" }),
    });
    const note = await noteRes.json();

    const res = await app.request(`/api/items/${note.id}/linked-todos`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(0);
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

  describe("batch develop", () => {
    it("transitions fleeting notes to developing", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const res = await app.request("/api/items", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ title: `Fleeting note ${i}` }),
        });
        const item = await res.json();
        ids.push(item.id);
      }

      const res = await app.request("/api/items/batch", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ ids, action: "develop" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.affected).toBe(2);
      expect(body.skipped).toBe(0);

      for (const id of ids) {
        const getRes = await app.request(`/api/items/${id}`, {
          headers: authHeaders(),
        });
        const item = await getRes.json();
        expect(item.status).toBe("developing");
      }
    });

    it("skips todos and non-fleeting notes", async () => {
      const ids: string[] = [];
      // Create a todo
      const todoRes = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "A todo", type: "todo" }),
      });
      ids.push((await todoRes.json()).id);
      // Create a developing note
      const noteRes = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Developing note", status: "developing" }),
      });
      ids.push((await noteRes.json()).id);

      const res = await app.request("/api/items/batch", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ ids, action: "develop" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.affected).toBe(0);
      expect(body.skipped).toBe(2);
    });
  });

  describe("batch mature", () => {
    it("transitions developing notes to permanent", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const res = await app.request("/api/items", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ title: `Dev note ${i}`, status: "developing" }),
        });
        const item = await res.json();
        ids.push(item.id);
      }

      const res = await app.request("/api/items/batch", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ ids, action: "mature" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.affected).toBe(2);
      expect(body.skipped).toBe(0);

      for (const id of ids) {
        const getRes = await app.request(`/api/items/${id}`, {
          headers: authHeaders(),
        });
        const item = await getRes.json();
        expect(item.status).toBe("permanent");
      }
    });

    it("skips non-developing notes", async () => {
      const ids: string[] = [];
      // Create a fleeting note
      const fleetingRes = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Fleeting note" }),
      });
      ids.push((await fleetingRes.json()).id);
      // Create a permanent note
      const permRes = await app.request("/api/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Permanent note", status: "permanent" }),
      });
      ids.push((await permRes.json()).id);

      const res = await app.request("/api/items/batch", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ ids, action: "mature" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.affected).toBe(0);
      expect(body.skipped).toBe(2);
    });
  });

  describe("batch done type filtering", () => {
    it("skips notes (only applies to todos)", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const res = await app.request("/api/items", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ title: `Note ${i}` }),
        });
        ids.push((await res.json()).id);
      }

      const res = await app.request("/api/items/batch", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ ids, action: "done" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.affected).toBe(0);
      expect(body.skipped).toBe(2);
    });
  });

  describe("batch active type filtering", () => {
    it("skips notes (only applies to todos)", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const res = await app.request("/api/items", {
          method: "POST",
          headers: jsonHeaders(),
          body: JSON.stringify({ title: `Note ${i}`, status: "archived" }),
        });
        ids.push((await res.json()).id);
      }

      const res = await app.request("/api/items/batch", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ ids, action: "active" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.affected).toBe(0);
      expect(body.skipped).toBe(2);
    });
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

// ============================================================
// Export to Obsidian (POST /api/items/:id/export)
// ============================================================
describe("POST /api/items/:id/export", () => {
  let tempDir: string;

  beforeEach(async () => {
    const os = await import("node:os");
    const fs = await import("node:fs");
    tempDir = fs.mkdtempSync(os.tmpdir() + "/sparkle-api-export-test-");
  });

  afterEach(async () => {
    const fs = await import("node:fs");
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns 404 for nonexistent item", async () => {
    const res = await app.request("/api/items/nonexistent-id/export", {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("returns 400 for todo items", async () => {
    const createRes = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "A todo", type: "todo", status: "active" }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/items/${created.id}/export`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/only notes/i);
  });

  it("returns 400 for non-permanent notes", async () => {
    const createRes = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "Fleeting note", type: "note", status: "fleeting" }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/items/${created.id}/export`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/only permanent/i);
  });

  it("returns 500 when Obsidian export not configured", async () => {
    // Default settings: obsidian_enabled=false, vault_path=""
    const createRes = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "Permanent note", type: "note", status: "permanent" }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/items/${created.id}/export`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/not configured/i);
  });

  it("exports permanent note and updates status to exported", async () => {
    // Enable obsidian export via DB settings
    const { updateSettings: us } = await import("../../lib/settings.js");
    us(testSqlite, {
      obsidian_enabled: "true",
      obsidian_vault_path: tempDir,
      obsidian_inbox_folder: "0_Inbox",
    });

    const createRes = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        title: "Export Me",
        type: "note",
        status: "permanent",
        content: "Important content",
      }),
    });
    const created = await createRes.json();

    const res = await app.request(`/api/items/${created.id}/export`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe("0_Inbox/Export Me.md");

    // Verify file was written
    const fs = await import("node:fs");
    const filePath = `${tempDir}/0_Inbox/Export Me.md`;
    const content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("# Export Me");
    expect(content).toContain("Important content");

    // Verify status was updated to exported
    const getRes = await app.request(`/api/items/${created.id}`, {
      headers: authHeaders(),
    });
    const updatedItem = await getRes.json();
    expect(updatedItem.status).toBe("exported");
  });
});

// ============================================================
// Config Tests
// ============================================================
describe("GET /api/config", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/config");
    expect(res.status).toBe(401);
  });

  it("returns obsidian_export_enabled=false by default", async () => {
    const res = await app.request("/api/config", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.obsidian_export_enabled).toBe(false);
  });

  it("returns obsidian_export_enabled=true when enabled with vault path", async () => {
    const { updateSettings } = await import("../../lib/settings.js");
    updateSettings(testSqlite, {
      obsidian_enabled: "true",
      obsidian_vault_path: "/tmp/test-vault",
    });
    const res = await app.request("/api/config", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.obsidian_export_enabled).toBe(true);
  });

  it("returns obsidian_export_enabled=false when enabled but no vault path", async () => {
    const { updateSettings } = await import("../../lib/settings.js");
    updateSettings(testSqlite, {
      obsidian_enabled: "true",
      obsidian_vault_path: "",
    });
    const res = await app.request("/api/config", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.obsidian_export_enabled).toBe(false);
  });
});

// ============================================================
// Settings API Tests
// ============================================================
describe("GET /api/settings", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/settings");
    expect(res.status).toBe(401);
  });

  it("returns default settings", async () => {
    const res = await app.request("/api/settings", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      obsidian_enabled: "false",
      obsidian_vault_path: "",
      obsidian_inbox_folder: "0_Inbox",
      obsidian_export_mode: "overwrite",
    });
  });
});

describe("PUT /api/settings", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ obsidian_inbox_folder: "Inbox" }),
    });
    expect(res.status).toBe(401);
  });

  it("updates a single setting", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ obsidian_inbox_folder: "1_Inbox" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.obsidian_inbox_folder).toBe("1_Inbox");
  });

  it("updates multiple settings at once", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({
        obsidian_inbox_folder: "MyInbox",
        obsidian_export_mode: "new",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.obsidian_inbox_folder).toBe("MyInbox");
    expect(body.obsidian_export_mode).toBe("new");
  });

  it("returns 400 for unknown key", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ unknown_key: "value" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Unknown settings key/);
  });

  it("returns 400 for invalid obsidian_enabled value", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ obsidian_enabled: "yes" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/obsidian_enabled/);
  });

  it("returns 400 for invalid obsidian_export_mode value", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ obsidian_export_mode: "append" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/obsidian_export_mode/);
  });

  it("returns 400 for empty body", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/No settings/);
  });

  it("returns 400 when enabling with empty vault path", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ obsidian_enabled: "true" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/vault_path must be non-empty/);
  });

  it("returns 400 when enabling with non-writable vault path", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({
        obsidian_enabled: "true",
        obsidian_vault_path: "/nonexistent/path/that/does/not/exist",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not writable/);
  });

  it("enables obsidian with valid writable vault path", async () => {
    const os = await import("node:os");
    const fs = await import("node:fs");
    const tempDir = fs.mkdtempSync(os.tmpdir() + "/sparkle-settings-test-");
    try {
      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: jsonHeaders(),
        body: JSON.stringify({
          obsidian_enabled: "true",
          obsidian_vault_path: tempDir,
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.obsidian_enabled).toBe("true");
      expect(body.obsidian_vault_path).toBe(tempDir);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("allows disabling without vault path validation", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify({ obsidian_enabled: "false" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.obsidian_enabled).toBe("false");
  });
});

// ============================================================
// Import Old Format Rejection Tests
// ============================================================
describe("POST /api/import — old format rejection", () => {
  it("rejects import with old field name due_date", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "old-1",
            title: "Old format item",
            due_date: "2026-03-01",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Unrecognized field names/);
  });

  it("rejects import with old field name created_at", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "old-2",
            title: "Old format item",
            created_at: now,
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Unrecognized field names/);
  });

  it("rejects import with old status 'inbox'", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "old-3",
            title: "Old format item",
            status: "inbox",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Unrecognized field names/);
  });
});
