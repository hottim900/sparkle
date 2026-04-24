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

vi.mock("../../lib/private-session.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual };
});

import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { privateTokenMiddleware } from "../../middleware/private-token.js";
import { privateRouter } from "../private.js";
import { clearExpiredPrivateSessions } from "../../lib/private-session.js";
import { createItem } from "../../lib/items.js";

const TEST_TOKEN = "test-secret-token-12345";
const TEST_PIN = "123456";

function createApp() {
  const app = new Hono();
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => {
        return c.json({ error: "Request body too large (max 1MB)" }, 413);
      },
    }),
  );
  app.use("/api/*", authMiddleware);
  // Private token middleware on protected endpoints
  app.use("/api/private/items", privateTokenMiddleware);
  app.use("/api/private/items/*", privateTokenMiddleware);
  app.use("/api/private/search", privateTokenMiddleware);
  app.use("/api/private/tags", privateTokenMiddleware);
  app.use("/api/private/pin", privateTokenMiddleware);
  app.use("/api/private/lock", privateTokenMiddleware);
  app.route("/api/private", privateRouter);
  app.onError((err, c) => {
    console.error("Unhandled error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });
  return app;
}

let app: Hono;
let sessionToken: string;

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

function privateHeaders(): Record<string, string> {
  return {
    ...authHeaders(),
    "Content-Type": "application/json",
    "X-Private-Token": sessionToken,
  };
}

function jsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...authHeaders(),
    "Content-Type": "application/json",
    ...extra,
  };
}

/** Setup PIN + unlock to get a session token */
async function setupAndUnlock(testApp: Hono): Promise<string> {
  await testApp.request("/api/private/setup", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ pin: TEST_PIN }),
  });
  const unlockRes = await testApp.request("/api/private/unlock", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ pin: TEST_PIN }),
  });
  const body = await unlockRes.json();
  return body.token;
}

beforeAll(() => {
  process.env.AUTH_TOKEN = TEST_TOKEN;
});

beforeEach(async () => {
  const fresh = createTestDb();
  testDb = fresh.db;
  testSqlite = fresh.sqlite;
  app = createApp();
  clearExpiredPrivateSessions(0);
  sessionToken = await setupAndUnlock(app);
});

describe("Private CRUD routes", () => {
  // ============================================================
  // POST /api/private/items — Create
  // ============================================================
  describe("POST /api/private/items", () => {
    it("creates a private item", async () => {
      const res = await app.request("/api/private/items", {
        method: "POST",
        headers: privateHeaders(),
        body: JSON.stringify({ title: "Secret note", type: "note" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.title).toBe("Secret note");
      expect(body.is_private).toBe(1);
    });

    it("forces is_private=true even if body says false", async () => {
      const res = await app.request("/api/private/items", {
        method: "POST",
        headers: privateHeaders(),
        body: JSON.stringify({
          title: "Forced private",
          is_private: false,
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.is_private).toBe(1);
    });

    it("returns 400 for invalid body", async () => {
      const res = await app.request("/api/private/items", {
        method: "POST",
        headers: privateHeaders(),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("returns 401 without private token", async () => {
      const res = await app.request("/api/private/items", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "No token" }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ============================================================
  // GET /api/private/items — List
  // ============================================================
  describe("GET /api/private/items", () => {
    it("returns only private items", async () => {
      // Create a public item directly
      createItem(testDb, { title: "Public note" });
      // Create a private item via API
      await app.request("/api/private/items", {
        method: "POST",
        headers: privateHeaders(),
        body: JSON.stringify({ title: "Private note" }),
      });

      const res = await app.request("/api/private/items", {
        headers: { ...authHeaders(), "X-Private-Token": sessionToken },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].title).toBe("Private note");
      expect(body.total).toBe(1);
    });

    it("filters by type", async () => {
      await app.request("/api/private/items", {
        method: "POST",
        headers: privateHeaders(),
        body: JSON.stringify({ title: "Private note", type: "note" }),
      });
      await app.request("/api/private/items", {
        method: "POST",
        headers: privateHeaders(),
        body: JSON.stringify({ title: "Private todo", type: "todo" }),
      });

      const res = await app.request("/api/private/items?type=todo", {
        headers: { ...authHeaders(), "X-Private-Token": sessionToken },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].title).toBe("Private todo");
    });

    it("filters by tag", async () => {
      await app.request("/api/private/items", {
        method: "POST",
        headers: privateHeaders(),
        body: JSON.stringify({
          title: "Tagged note",
          tags: ["secret"],
        }),
      });
      await app.request("/api/private/items", {
        method: "POST",
        headers: privateHeaders(),
        body: JSON.stringify({ title: "Untagged note" }),
      });

      const res = await app.request("/api/private/items?tag=secret", {
        headers: { ...authHeaders(), "X-Private-Token": sessionToken },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].title).toBe("Tagged note");
    });

    it("returns 401 without private token", async () => {
      const res = await app.request("/api/private/items", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(401);
    });
  });

  // ============================================================
  // GET /api/private/items/:id — Get single
  // ============================================================
  describe("GET /api/private/items/:id", () => {
    it("returns a private item by id", async () => {
      const createRes = await app.request("/api/private/items", {
        method: "POST",
        headers: privateHeaders(),
        body: JSON.stringify({ title: "Get me" }),
      });
      const created = await createRes.json();

      const res = await app.request(`/api/private/items/${created.id}`, {
        headers: { ...authHeaders(), "X-Private-Token": sessionToken },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(created.id);
      expect(body.title).toBe("Get me");
    });

    it("returns 404 for public items", async () => {
      const publicItem = createItem(testDb, { title: "Public" });

      const res = await app.request(`/api/private/items/${publicItem.id}`, {
        headers: { ...authHeaders(), "X-Private-Token": sessionToken },
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent id", async () => {
      const res = await app.request("/api/private/items/00000000-0000-0000-0000-000000000000", {
        headers: { ...authHeaders(), "X-Private-Token": sessionToken },
      });
      expect(res.status).toBe(404);
    });

    it("returns 401 without private token", async () => {
      const res = await app.request("/api/private/items/00000000-0000-0000-0000-000000000000", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(401);
    });
  });

  // ============================================================
  // PATCH /api/private/items/:id — Update
  // ============================================================
  describe("PATCH /api/private/items/:id", () => {
    it("updates a private item", async () => {
      const createRes = await app.request("/api/private/items", {
        method: "POST",
        headers: privateHeaders(),
        body: JSON.stringify({ title: "Original" }),
      });
      const created = await createRes.json();

      const res = await app.request(`/api/private/items/${created.id}`, {
        method: "PATCH",
        headers: privateHeaders(),
        body: JSON.stringify({ title: "Updated" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe("Updated");
    });

    it("returns 404 for non-existent id", async () => {
      const res = await app.request("/api/private/items/00000000-0000-0000-0000-000000000000", {
        method: "PATCH",
        headers: privateHeaders(),
        body: JSON.stringify({ title: "Nope" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 401 without private token", async () => {
      const res = await app.request("/api/private/items/00000000-0000-0000-0000-000000000000", {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ title: "Nope" }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ============================================================
  // DELETE /api/private/items/:id — Delete
  // ============================================================
  describe("DELETE /api/private/items/:id", () => {
    it("deletes a private item", async () => {
      const createRes = await app.request("/api/private/items", {
        method: "POST",
        headers: privateHeaders(),
        body: JSON.stringify({ title: "Delete me" }),
      });
      const created = await createRes.json();

      const res = await app.request(`/api/private/items/${created.id}`, {
        method: "DELETE",
        headers: { ...authHeaders(), "X-Private-Token": sessionToken },
      });
      expect(res.status).toBe(204);
    });

    it("returns 404 for public items", async () => {
      const publicItem = createItem(testDb, { title: "Public" });

      const res = await app.request(`/api/private/items/${publicItem.id}`, {
        method: "DELETE",
        headers: { ...authHeaders(), "X-Private-Token": sessionToken },
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent id", async () => {
      const res = await app.request("/api/private/items/00000000-0000-0000-0000-000000000000", {
        method: "DELETE",
        headers: { ...authHeaders(), "X-Private-Token": sessionToken },
      });
      expect(res.status).toBe(404);
    });

    it("returns 401 without private token", async () => {
      const res = await app.request("/api/private/items/00000000-0000-0000-0000-000000000000", {
        method: "DELETE",
        headers: authHeaders(),
      });
      expect(res.status).toBe(401);
    });
  });

  // ============================================================
  // GET /api/private/search — Search
  // ============================================================
  describe("GET /api/private/search", () => {
    it("searches only private items", async () => {
      // Create public item directly
      createItem(testDb, { title: "Public searchable" });
      // Create private item via API
      await app.request("/api/private/items", {
        method: "POST",
        headers: privateHeaders(),
        body: JSON.stringify({ title: "Private searchable" }),
      });

      const res = await app.request("/api/private/search?q=searchable", {
        headers: { ...authHeaders(), "X-Private-Token": sessionToken },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(1);
      expect(body.results[0].title).toBe("Private searchable");
    });

    it("returns 400 without query", async () => {
      const res = await app.request("/api/private/search", {
        headers: { ...authHeaders(), "X-Private-Token": sessionToken },
      });
      expect(res.status).toBe(400);
    });

    it("returns 401 without private token", async () => {
      const res = await app.request("/api/private/search?q=test", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(401);
    });
  });

  // ============================================================
  // GET /api/private/tags — Tags
  // ============================================================
  describe("GET /api/private/tags", () => {
    it("returns only tags from private items", async () => {
      // Create public item with tag
      createItem(testDb, { title: "Public", tags: ["public-tag"] });
      // Create private item with tag
      await app.request("/api/private/items", {
        method: "POST",
        headers: privateHeaders(),
        body: JSON.stringify({ title: "Private", tags: ["private-tag"] }),
      });

      const res = await app.request("/api/private/tags", {
        headers: { ...authHeaders(), "X-Private-Token": sessionToken },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tags).toEqual(["private-tag"]);
    });

    it("returns empty array when no private items have tags", async () => {
      const res = await app.request("/api/private/tags", {
        headers: { ...authHeaders(), "X-Private-Token": sessionToken },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tags).toEqual([]);
    });

    it("returns 401 without private token", async () => {
      const res = await app.request("/api/private/tags", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(401);
    });
  });
});
