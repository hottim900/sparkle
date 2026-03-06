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

import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { categoriesRouter } from "../categories.js";

const TEST_TOKEN = "test-secret-token-12345";

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
  app.route("/api/categories", categoriesRouter);
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

// Helper to create a category via API
async function createCategory(name: string, color?: string) {
  const body: Record<string, string> = { name };
  if (color) body.color = color;
  const res = await app.request("/api/categories", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
  return res;
}

describe("Categories routes", () => {
  // ============================================================
  // Auth
  // ============================================================
  describe("Auth", () => {
    it("returns 401 when no Authorization header", async () => {
      const res = await app.request("/api/categories");
      expect(res.status).toBe(401);
    });
  });

  // ============================================================
  // POST /api/categories
  // ============================================================
  describe("POST /api/categories", () => {
    it("creates a category and returns 201", async () => {
      const res = await createCategory("Work", "#ff0000");
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeTruthy();
      expect(body.name).toBe("Work");
      expect(body.color).toBe("#ff0000");
      expect(body.sort_order).toBe(0);
    });

    it("returns 400 when name is missing", async () => {
      const res = await app.request("/api/categories", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns 400 when name is empty string", async () => {
      const res = await createCategory("");
      expect(res.status).toBe(400);
    });

    it("returns 409 when name already exists", async () => {
      await createCategory("Duplicate");
      const res = await createCategory("Duplicate");
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toMatch(/already exists/i);
    });
  });

  // ============================================================
  // GET /api/categories
  // ============================================================
  describe("GET /api/categories", () => {
    it("returns 200 with empty list initially", async () => {
      const res = await app.request("/api/categories", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.categories).toEqual([]);
    });

    it("returns all categories", async () => {
      await createCategory("A");
      await createCategory("B");
      const res = await app.request("/api/categories", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.categories).toHaveLength(2);
    });
  });

  // ============================================================
  // PATCH /api/categories/:id
  // ============================================================
  describe("PATCH /api/categories/:id", () => {
    it("updates a category and returns 200", async () => {
      const createRes = await createCategory("Old");
      const created = await createRes.json();

      const res = await app.request(`/api/categories/${created.id}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ name: "New" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe("New");
    });

    it("returns 404 for non-existent id", async () => {
      const res = await app.request("/api/categories/non-existent-id", {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ name: "Nope" }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/not found/i);
    });

    it("returns 400 for invalid input", async () => {
      const createRes = await createCategory("Valid");
      const created = await createRes.json();

      const res = await app.request(`/api/categories/${created.id}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ color: "not-a-hex" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 409 when renaming to existing name", async () => {
      await createCategory("Existing");
      const createRes = await createCategory("Other");
      const created = await createRes.json();

      const res = await app.request(`/api/categories/${created.id}`, {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ name: "Existing" }),
      });
      expect(res.status).toBe(409);
    });
  });

  // ============================================================
  // DELETE /api/categories/:id
  // ============================================================
  describe("DELETE /api/categories/:id", () => {
    it("deletes a category and returns 200", async () => {
      const createRes = await createCategory("ToDelete");
      const created = await createRes.json();

      const res = await app.request(`/api/categories/${created.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("returns 404 for non-existent id", async () => {
      const res = await app.request("/api/categories/non-existent-id", {
        method: "DELETE",
        headers: authHeaders(),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/not found/i);
    });
  });

  // ============================================================
  // PATCH /api/categories/reorder
  // ============================================================
  describe("PATCH /api/categories/reorder", () => {
    it("reorders categories and returns 200", async () => {
      const res1 = await createCategory("A");
      const res2 = await createCategory("B");
      const cat1 = await res1.json();
      const cat2 = await res2.json();

      const res = await app.request("/api/categories/reorder", {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({
          items: [
            { id: cat2.id, sort_order: 0 },
            { id: cat1.id, sort_order: 1 },
          ],
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("returns 400 for empty items array", async () => {
      const res = await app.request("/api/categories/reorder", {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ items: [] }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when items is missing", async () => {
      const res = await app.request("/api/categories/reorder", {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });
});
