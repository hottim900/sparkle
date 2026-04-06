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

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { itemsRouter, deriveTitleFromContent } from "../items.js";

const TEST_TOKEN = "test-secret-token-12345";

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
  app.route("/api/items", itemsRouter);
  return app;
}

function jsonHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TEST_TOKEN}`,
  };
}

let app: ReturnType<typeof createApp>;

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
// Schema Validation — title optional for note/scratch
// ============================================================
describe("POST /api/items — auto-title schema validation", () => {
  it("note without title, with content → 201", async () => {
    const res = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "note", content: "First line\nSecond" }),
    });
    expect(res.status).toBe(201);
    const item = await res.json();
    expect(item.title).toBe("First line");
    expect(item.content).toBe("First line\nSecond");
  });

  it("scratch without title, with content → 201", async () => {
    const res = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "scratch", content: "Quick note" }),
    });
    expect(res.status).toBe(201);
    const item = await res.json();
    expect(item.title).toBe("Quick note");
  });

  it("todo without title → 400", async () => {
    const res = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "todo", content: "Buy milk" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Title required for todo/i);
  });

  it("both title and content omitted → 400", async () => {
    const res = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "note" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Content or title required/i);
  });

  it("both title and content provided → 201, uses provided title", async () => {
    const res = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "note", title: "My Note", content: "Body text" }),
    });
    expect(res.status).toBe(201);
    const item = await res.json();
    expect(item.title).toBe("My Note");
    expect(item.content).toBe("Body text");
  });

  it("title provided, content omitted → 201", async () => {
    const res = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "note", title: "Title Only" }),
    });
    expect(res.status).toBe(201);
    const item = await res.json();
    expect(item.title).toBe("Title Only");
  });

  it("whitespace-only content, no title → 400", async () => {
    const res = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "note", content: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("existing type-status validation still works", async () => {
    const res = await app.request("/api/items", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ type: "note", status: "active", content: "x" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid status/i);
  });
});

// ============================================================
// Title Derivation (unit tests for deriveTitleFromContent)
// ============================================================
describe("deriveTitleFromContent", () => {
  it("normal multi-line → first line", () => {
    expect(deriveTitleFromContent("First line\nSecond line")).toBe("First line");
  });

  it("single line → same string", () => {
    expect(deriveTitleFromContent("Just one line")).toBe("Just one line");
  });

  it("first line > 80 chars → truncated with ...", () => {
    const long = "A".repeat(100);
    expect(deriveTitleFromContent(long + "\nRest")).toBe("A".repeat(80) + "...");
  });

  it("first line exactly 80 chars → no truncation", () => {
    const exact = "A".repeat(80);
    expect(deriveTitleFromContent(exact + "\nRest")).toBe(exact);
  });

  it("empty first line → uses next non-empty line", () => {
    expect(deriveTitleFromContent("\nActual content")).toBe("Actual content");
  });

  it("multiple empty lines → finds first non-empty", () => {
    expect(deriveTitleFromContent("\n\n\nContent here")).toBe("Content here");
  });

  it("all empty lines → empty string", () => {
    expect(deriveTitleFromContent("\n\n\n")).toBe("");
  });

  it("unicode/emoji preserved", () => {
    expect(deriveTitleFromContent("Hello 世界 🌍\nMore")).toBe("Hello 世界 🌍");
  });

  it("leading/trailing whitespace trimmed", () => {
    expect(deriveTitleFromContent("  padded line  \nMore")).toBe("padded line");
  });

  it("truncation does not split surrogate pairs", () => {
    const s = "A".repeat(79) + "🌍🌍";
    const result = deriveTitleFromContent(s);
    expect(result).toBe("A".repeat(79) + "🌍...");
  });

  it("CRLF content handled correctly", () => {
    expect(deriveTitleFromContent("Line one\r\nLine two")).toBe("Line one");
  });
});
