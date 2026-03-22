import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb } from "../../test-utils.js";
import { bodyLimit } from "hono/body-limit";

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

import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { itemsRouter } from "../items.js";
import { sharesRouter } from "../shares.js";
import { publicRouter } from "../public.js";
import { items } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { importSchema } from "../../schemas/items.js";
import { ZodError } from "zod";

const TEST_TOKEN = "test-secret-token-12345";

function createApp() {
  const app = new Hono();
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json({ error: "Request body too large (max 1MB)" }, 413),
    }),
  );
  app.use("/api/*", authMiddleware);
  app.route("/api/items", itemsRouter);
  app.route("/api", sharesRouter);

  // Export endpoint (mirrors server/index.ts with private filter)
  app.get("/api/export", (c) => {
    const allItems = testDb.select().from(items).where(eq(items.is_private, 0)).limit(50000).all();
    return c.json({
      version: 2,
      exported_at: new Date().toISOString(),
      items: allItems,
    });
  });

  // Import endpoint (mirrors server/index.ts with private guards)
  app.post("/api/import", async (c) => {
    try {
      const body = await c.req.json();
      const { items: importItems } = importSchema.parse(body);

      let imported = 0;
      let updated = 0;
      let skipped = 0;

      for (const item of importItems) {
        const existing = testDb.select().from(items).where(eq(items.id, item.id)).get();

        if (existing) {
          if (existing.is_private) {
            skipped++;
            continue;
          }
          testDb
            .update(items)
            .set({
              type: item.type,
              title: item.title,
              content: item.content,
              status: item.status,
              priority: item.priority,
              due: item.due,
              tags: JSON.stringify(item.tags),
              origin: item.origin,
              source: item.source,
              aliases: JSON.stringify(item.aliases),
              linked_note_id: item.linked_note_id,
              created: item.created,
              modified: item.modified,
            })
            .where(eq(items.id, item.id))
            .run();
          updated++;
        } else {
          testDb
            .insert(items)
            .values({
              ...item,
              tags: JSON.stringify(item.tags),
              aliases: JSON.stringify(item.aliases),
              is_private: 0,
            })
            .run();
          imported++;
        }
      }

      return c.json({ imported, updated, skipped });
    } catch (e) {
      if (e instanceof ZodError) {
        return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
      }
      throw e;
    }
  });

  app.route("/", publicRouter);
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

const NOW = new Date().toISOString();

function insertItem(
  overrides: Partial<{
    id: string;
    type: string;
    title: string;
    content: string;
    status: string;
    tags: string;
    is_private: number;
    created: string;
    modified: string;
  }> = {},
) {
  const id = overrides.id ?? "test-item-1";
  testSqlite
    .prepare(
      "INSERT INTO items (id, type, title, content, status, tags, is_private, created, modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      overrides.type ?? "note",
      overrides.title ?? "Test Note",
      overrides.content ?? "Test content",
      overrides.status ?? "fleeting",
      overrides.tags ?? "[]",
      overrides.is_private ?? 0,
      overrides.created ?? NOW,
      overrides.modified ?? NOW,
    );
  return id;
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
// PATCH /:id — Private item guards
// ============================================================
describe("PATCH /api/items/:id — private guards", () => {
  it("returns 404 for private items", async () => {
    const id = insertItem({ is_private: 1 });
    const res = await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "Updated" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("allows setting is_private: true on public items", async () => {
    const id = insertItem({ is_private: 0 });
    const res = await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ is_private: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_private).toBe(1);
  });

  it("returns 400 when converting private note to scratch", async () => {
    // Use a public item but set is_private: true simultaneously with type: scratch
    const id = insertItem({ is_private: 0 });
    const res = await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "scratch", is_private: true }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/private.*scratch/i);
  });

  it("revokes share tokens when marking item as private", async () => {
    const id = insertItem({ is_private: 0 });

    // Create a share for this item
    const shareRes = await app.request(`/api/items/${id}/share`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ visibility: "unlisted" }),
    });
    expect(shareRes.status).toBe(201);

    // Verify share exists
    const sharesRes = await app.request(`/api/items/${id}/shares`, {
      headers: authHeaders(),
    });
    const sharesBefore = await sharesRes.json();
    expect(sharesBefore.shares).toHaveLength(1);

    // Mark as private
    const patchRes = await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ is_private: true }),
    });
    expect(patchRes.status).toBe(200);

    // Verify shares are revoked
    const sharesAfterRes = await app.request(`/api/items/${id}/shares`, {
      headers: authHeaders(),
    });
    const sharesAfter = await sharesAfterRes.json();
    expect(sharesAfter.shares).toHaveLength(0);
  });
});

// ============================================================
// DELETE /:id — Private item guard
// ============================================================
describe("DELETE /api/items/:id — private guard", () => {
  it("returns 404 for private items", async () => {
    const id = insertItem({ is_private: 1 });
    const res = await app.request(`/api/items/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);

    // Verify the private item still exists in DB
    const row = testSqlite.prepare("SELECT id FROM items WHERE id = ?").get(id);
    expect(row).toBeTruthy();
  });

  it("deletes public items normally", async () => {
    const id = insertItem({ is_private: 0 });
    const res = await app.request(`/api/items/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ============================================================
// Batch operations — Private item filtering
// ============================================================
describe("POST /api/items/batch — private item filtering", () => {
  it("batch delete skips private items silently", async () => {
    const publicId = insertItem({ id: "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5", is_private: 0 });
    const privateId = insertItem({ id: "f1e2d3c4-b5a6-4978-9abc-def012345678", is_private: 1 });

    const res = await app.request("/api/items/batch", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        ids: [publicId, privateId],
        action: "delete",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(1);
    expect(body.skipped).toBe(1);

    // Verify private item still exists
    const row = testSqlite.prepare("SELECT id FROM items WHERE id = ?").get(privateId);
    expect(row).toBeTruthy();
  });

  it("batch archive skips private items silently", async () => {
    const publicId = insertItem({
      id: "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
      is_private: 0,
      status: "fleeting",
    });
    const privateId = insertItem({
      id: "f1e2d3c4-b5a6-4978-9abc-def012345678",
      is_private: 1,
      status: "fleeting",
    });

    const res = await app.request("/api/items/batch", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        ids: [publicId, privateId],
        action: "archive",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(1);
    expect(body.skipped).toBe(1);

    // Verify private item is unchanged
    const row = testSqlite.prepare("SELECT status FROM items WHERE id = ?").get(privateId) as {
      status: string;
    };
    expect(row.status).toBe("fleeting");
  });

  it("batch done skips private todos silently", async () => {
    const publicId = insertItem({
      id: "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
      type: "todo",
      status: "active",
      is_private: 0,
    });
    const privateId = insertItem({
      id: "f1e2d3c4-b5a6-4978-9abc-def012345678",
      type: "todo",
      status: "active",
      is_private: 1,
    });

    const res = await app.request("/api/items/batch", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        ids: [publicId, privateId],
        action: "done",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(1);
    expect(body.skipped).toBe(1);
  });
});

// ============================================================
// POST /api/items/:id/share — Private item guard
// ============================================================
describe("POST /api/items/:id/share — private guard", () => {
  it("returns 404 for private items", async () => {
    const id = insertItem({ is_private: 1 });
    const res = await app.request(`/api/items/${id}/share`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ visibility: "unlisted" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });
});

// ============================================================
// GET /api/items/:id/linked-todos — Private note guard
// ============================================================
describe("GET /api/items/:id/linked-todos — private guard", () => {
  it("returns 404 if note is private", async () => {
    const id = insertItem({ is_private: 1 });
    const res = await app.request(`/api/items/${id}/linked-todos`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("returns linked todos for public note", async () => {
    const noteId = insertItem({ id: "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5", is_private: 0 });
    // Create a linked todo
    insertItem({
      id: "f1e2d3c4-b5a6-4978-9abc-def012345678",
      type: "todo",
      status: "active",
      is_private: 0,
    });
    testSqlite
      .prepare("UPDATE items SET linked_note_id = ? WHERE id = ?")
      .run(noteId, "f1e2d3c4-b5a6-4978-9abc-def012345678");

    const res = await app.request(`/api/items/${noteId}/linked-todos`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
  });
});

// ============================================================
// GET /api/export — Private item exclusion
// ============================================================
describe("GET /api/export — private item exclusion", () => {
  it("excludes private items from export", async () => {
    insertItem({
      id: "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5",
      title: "Public Note",
      is_private: 0,
    });
    insertItem({
      id: "f1e2d3c4-b5a6-4978-9abc-def012345678",
      title: "Private Note",
      is_private: 1,
    });

    const res = await app.request("/api/export", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe("Public Note");
  });
});

// ============================================================
// POST /api/import — Private item protection
// ============================================================
describe("POST /api/import — private item protection", () => {
  it("skips existing private items on upsert", async () => {
    const id = "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5";
    insertItem({ id, title: "Original Private", is_private: 1 });

    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id,
            type: "note",
            title: "Overwritten Title",
            content: "Overwritten content",
            status: "fleeting",
            priority: null,
            due: null,
            tags: [],
            origin: "",
            source: null,
            aliases: [],
            linked_note_id: null,
            created: NOW,
            modified: NOW,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe(1);
    expect(body.updated).toBe(0);

    // Verify original title is preserved
    const row = testSqlite.prepare("SELECT title FROM items WHERE id = ?").get(id) as {
      title: string;
    };
    expect(row.title).toBe("Original Private");
  });

  it("imports new items as public (is_private = 0)", async () => {
    const id = "01234567-89ab-4cde-8f01-23456789abcd";
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id,
            type: "note",
            title: "Imported Note",
            content: "",
            status: "fleeting",
            priority: null,
            due: null,
            tags: [],
            origin: "",
            source: null,
            aliases: [],
            linked_note_id: null,
            created: NOW,
            modified: NOW,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1);

    // Verify is_private is 0
    const row = testSqlite.prepare("SELECT is_private FROM items WHERE id = ?").get(id) as {
      is_private: number;
    };
    expect(row.is_private).toBe(0);
  });
});

// ============================================================
// Share list endpoints — Private item filtering
// ============================================================
describe("Share list endpoints — private item filtering", () => {
  it("listShares excludes shares for items that became private", async () => {
    const id = insertItem({ is_private: 0 });

    // Create share
    await app.request(`/api/items/${id}/share`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ visibility: "unlisted" }),
    });

    // Directly set item to private in DB (simulating the result after PATCH)
    testSqlite.prepare("UPDATE items SET is_private = 1 WHERE id = ?").run(id);

    // List shares — should be empty (item is now private)
    const res = await app.request("/api/shares", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shares).toHaveLength(0);
  });

  it("getShareByToken returns null for private item shares", async () => {
    const id = insertItem({ is_private: 0 });

    // Create share
    const createRes = await app.request(`/api/items/${id}/share`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ visibility: "unlisted" }),
    });
    const { share } = await createRes.json();

    // Directly set item to private
    testSqlite.prepare("UPDATE items SET is_private = 1 WHERE id = ?").run(id);

    // Access share via public API — should return 404
    const res = await app.request(`/api/public/${share.token}`);
    expect(res.status).toBe(404);
  });
});
