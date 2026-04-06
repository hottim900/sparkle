import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb } from "../../test-utils.js";
import { bodyLimit } from "hono/body-limit";

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

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { privateTokenMiddleware } from "../../middleware/private-token.js";
import { privateRouter } from "../private.js";
import { clearExpiredPrivateSessions } from "../../lib/private-session.js";

const TEST_TOKEN = "test-secret-token-12345";
const TEST_PIN = "123456";

function createApp() {
  const app = new Hono();
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.json({ error: "Request body too large" }, 413),
    }),
  );
  app.use("/api/*", authMiddleware);
  app.use("/api/private/items", privateTokenMiddleware);
  app.use("/api/private/items/*", privateTokenMiddleware);
  app.route("/api/private", privateRouter);
  return app;
}

let app: ReturnType<typeof createApp>;
let sessionToken: string;

function privateHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TEST_TOKEN}`,
    "Content-Type": "application/json",
    "X-Private-Token": sessionToken,
  };
}

async function setupAndUnlock(testApp: Hono): Promise<string> {
  await testApp.request("/api/private/setup", {
    method: "POST",
    headers: { Authorization: `Bearer ${TEST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ pin: TEST_PIN }),
  });
  const unlockRes = await testApp.request("/api/private/unlock", {
    method: "POST",
    headers: { Authorization: `Bearer ${TEST_TOKEN}`, "Content-Type": "application/json" },
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

// ============================================================
// POST /api/private/items — auto-title for private items
// ============================================================
describe("POST /api/private/items — auto-title", () => {
  it("note without title, with content → 201, title derived from first line", async () => {
    const res = await app.request("/api/private/items", {
      method: "POST",
      headers: privateHeaders(),
      body: JSON.stringify({ type: "note", content: "First line\nSecond" }),
    });
    expect(res.status).toBe(201);
    const item = await res.json();
    expect(item.title).toBe("First line");
    expect(item.content).toBe("First line\nSecond");
    expect(item.is_private).toBeTruthy();
  });

  it("scratch without title, with content → 201", async () => {
    const res = await app.request("/api/private/items", {
      method: "POST",
      headers: privateHeaders(),
      body: JSON.stringify({ type: "scratch", content: "Quick scratch" }),
    });
    expect(res.status).toBe(201);
    const item = await res.json();
    expect(item.title).toBe("Quick scratch");
  });

  it("todo without title → 400", async () => {
    const res = await app.request("/api/private/items", {
      method: "POST",
      headers: privateHeaders(),
      body: JSON.stringify({ type: "todo", content: "Buy milk" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Title required for todo/i);
  });

  it("both title and content omitted → 400", async () => {
    const res = await app.request("/api/private/items", {
      method: "POST",
      headers: privateHeaders(),
      body: JSON.stringify({ type: "note" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Content or title required/i);
  });

  it("whitespace-only content, no title → 400", async () => {
    const res = await app.request("/api/private/items", {
      method: "POST",
      headers: privateHeaders(),
      body: JSON.stringify({ type: "note", content: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("both title and content provided → uses provided title", async () => {
    const res = await app.request("/api/private/items", {
      method: "POST",
      headers: privateHeaders(),
      body: JSON.stringify({ type: "note", title: "My Note", content: "Body text" }),
    });
    expect(res.status).toBe(201);
    const item = await res.json();
    expect(item.title).toBe("My Note");
    expect(item.content).toBe("Body text");
  });

  it("long first line truncated to 80 chars with ...", async () => {
    const long = "A".repeat(100);
    const res = await app.request("/api/private/items", {
      method: "POST",
      headers: privateHeaders(),
      body: JSON.stringify({ type: "note", content: long + "\nMore" }),
    });
    expect(res.status).toBe(201);
    const item = await res.json();
    expect(item.title).toBe("A".repeat(80) + "...");
  });

  it("empty first line → uses next non-empty line", async () => {
    const res = await app.request("/api/private/items", {
      method: "POST",
      headers: privateHeaders(),
      body: JSON.stringify({ type: "note", content: "\n\nActual content" }),
    });
    expect(res.status).toBe(201);
    const item = await res.json();
    expect(item.title).toBe("Actual content");
  });
});
