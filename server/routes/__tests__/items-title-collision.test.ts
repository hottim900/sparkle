import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb, insertActiveRow } from "../../test-utils.js";
import { bodyLimit } from "hono/body-limit";

/**
 * Pre-PR0e + ENG-7: createItem / updateItem map TitleCollisionError to HTTP 409
 * with a structured `code: "TITLE_COLLISION"` payload so frontend and MCP can
 * surface the conflict without parsing prose.
 */

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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), debug: vi.fn() },
}));

import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { itemsRouter } from "../items.js";

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
  app.onError((err, c) => {
    console.error("Unhandled error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });
  return app;
}

let app: Hono;

function jsonHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}`, "Content-Type": "application/json" };
}

beforeAll(() => {
  process.env.AUTH_TOKEN = TEST_TOKEN;
});

beforeEach(() => {
  const t = createTestDb();
  testSqlite = t.sqlite;
  testDb = t.db;
  app = createApp();
});

describe("POST /api/items title collision", () => {
  it("returns 409 with code=TITLE_COLLISION when title already exists", async () => {
    insertActiveRow(testSqlite, { title: "Taken" });

    const res = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "Taken", content: "anything" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; attempted_title: string };
    expect(body.code).toBe("TITLE_COLLISION");
    expect(body.attempted_title).toBe("Taken");
  });

  it("returns 409 on case-insensitive collision (resolver normalization)", async () => {
    insertActiveRow(testSqlite, { title: "MixedCase" });

    const res = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "MIXEDCASE", content: "" }),
    });
    expect(res.status).toBe(409);
  });

  it("allows duplicate when title is on the 未命名 allowlist", async () => {
    insertActiveRow(testSqlite, { title: "未命名" });

    const res = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "未命名", content: "" }),
    });
    expect(res.status).toBe(201);
  });
});

describe("PATCH /api/items/:id title collision", () => {
  it("returns 409 when renaming to an existing title", async () => {
    insertActiveRow(testSqlite, { title: "Apple" });
    const bananaId = insertActiveRow(testSqlite, { title: "Banana" });

    const res = await app.request(`/api/items/${bananaId}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "Apple" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; attempted_title: string };
    expect(body.code).toBe("TITLE_COLLISION");
    expect(body.attempted_title).toBe("Apple");
  });

  it("allows self-rename (same NFC after normalization)", async () => {
    const id = insertActiveRow(testSqlite, { title: "Same" });

    const res = await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "SAME" }),
    });
    // exceptId lets the row claim its own normalized form even if case differs.
    expect(res.status).toBe(200);
  });
});
