import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { setupFTS } from "../../db/fts.js";
import { parseLineMessage } from "../../lib/line.js";

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

// Now import modules that depend on the mocked db
import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { webhookRouter } from "../webhook.js";
import { items } from "../../db/schema.js";

// ============================================================
// parseLineMessage unit tests (preserved from C2)
// ============================================================
describe("parseLineMessage", () => {
  it("parses simple text as note title", () => {
    const result = parseLineMessage("Hello world");
    expect(result.title).toBe("Hello world");
    expect(result.type).toBe("note");
    expect(result.priority).toBeNull();
    expect(result.content).toBe("");
  });

  it("parses multiline text: first line as title, rest as content", () => {
    const result = parseLineMessage("First line\nSecond line\nThird line");
    expect(result.title).toBe("First line");
    expect(result.content).toBe("Second line\nThird line");
  });

  it("parses !todo prefix to set type=todo", () => {
    const result = parseLineMessage("!todo Buy groceries");
    expect(result.title).toBe("Buy groceries");
    expect(result.type).toBe("todo");
  });

  it("parses !high prefix to set priority=high", () => {
    const result = parseLineMessage("!high Urgent task");
    expect(result.title).toBe("Urgent task");
    expect(result.priority).toBe("high");
    expect(result.type).toBe("note");
  });

  it("parses combined !todo !high prefixes", () => {
    const result = parseLineMessage("!todo !high Important task");
    expect(result.title).toBe("Important task");
    expect(result.type).toBe("todo");
    expect(result.priority).toBe("high");
  });

  it("handles !high !todo order too", () => {
    const result = parseLineMessage("!high !todo Another task");
    expect(result.title).toBe("Another task");
    expect(result.type).toBe("todo");
    expect(result.priority).toBe("high");
  });

  it("trims whitespace", () => {
    const result = parseLineMessage("  Hello world  ");
    expect(result.title).toBe("Hello world");
  });

  it("returns empty title for blank message", () => {
    const result = parseLineMessage("");
    expect(result.title).toBe("");
    expect(result.content).toBe("");
    expect(result.type).toBe("note");
    expect(result.priority).toBeNull();
  });

  it("sets source to 'LINE \u8F49\u50B3' when isForwarded is true", () => {
    const result = parseLineMessage("Hello", true);
    expect(result.source).toBe("LINE \u8F49\u50B3");
  });

  it("sets source to 'LINE' by default", () => {
    const result = parseLineMessage("Hello");
    expect(result.source).toBe("LINE");
  });
});

// ============================================================
// Webhook endpoint integration tests
// ============================================================

const TEST_TOKEN = "test-secret-token-12345";
const TEST_LINE_SECRET = "test-line-channel-secret";
const TEST_LINE_ACCESS_TOKEN = "test-line-access-token";

function makeSignature(body: string, secret: string): string {
  return crypto.createHmac("SHA256", secret).update(body).digest("base64");
}

function createApp() {
  const app = new Hono();
  app.use("/api/*", authMiddleware);
  app.route("/api/webhook", webhookRouter);
  return app;
}

describe("POST /api/webhook/line", () => {
  let app: Hono;

  beforeAll(() => {
    process.env.AUTH_TOKEN = TEST_TOKEN;
  });

  beforeEach(() => {
    const fresh = createTestDb();
    testDb = fresh.db;
    testSqlite = fresh.sqlite;
    app = createApp();

    // Mock fetch to prevent actual LINE API calls
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok")));
  });

  it("returns 401 with invalid signature", async () => {
    process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

    const body = JSON.stringify({
      events: [
        {
          type: "message",
          message: { type: "text", text: "Hello" },
          replyToken: "token123",
        },
      ],
    });

    const res = await app.request("/api/webhook/line", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-line-signature": "invalid-signature",
      },
      body,
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Invalid signature");
  });

  it("returns 500 when LINE credentials not configured", async () => {
    delete process.env.LINE_CHANNEL_SECRET;
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;

    const body = JSON.stringify({ events: [] });
    const res = await app.request("/api/webhook/line", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-line-signature": "anything",
      },
      body,
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("LINE not configured");
  });

  it("creates inbox item from text message with valid signature", async () => {
    process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

    const body = JSON.stringify({
      events: [
        {
          type: "message",
          message: { type: "text", text: "Buy milk" },
          replyToken: "reply-token-abc",
        },
      ],
    });

    const signature = makeSignature(body, TEST_LINE_SECRET);

    const res = await app.request("/api/webhook/line", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-line-signature": signature,
      },
      body,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Verify the item was created in the database
    const allItems = testDb.select().from(items).all();
    expect(allItems).toHaveLength(1);
    expect(allItems[0].title).toBe("Buy milk");
    expect(allItems[0].status).toBe("inbox");
    expect(allItems[0].source).toBe("LINE");
  });

  it("returns ok:true for non-text message events", async () => {
    process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

    const body = JSON.stringify({
      events: [
        {
          type: "message",
          message: { type: "image", id: "img123" },
          replyToken: "reply-token-xyz",
        },
      ],
    });

    const signature = makeSignature(body, TEST_LINE_SECRET);

    const res = await app.request("/api/webhook/line", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-line-signature": signature,
      },
      body,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    // Verify no items were created
    const allItems = testDb.select().from(items).all();
    expect(allItems).toHaveLength(0);
  });

  it("does not require Bearer token auth", async () => {
    process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
    process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

    const body = JSON.stringify({ events: [] });
    const signature = makeSignature(body, TEST_LINE_SECRET);

    // No Authorization header - should still work (auth skipped for webhook paths)
    const res = await app.request("/api/webhook/line", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-line-signature": signature,
      },
      body,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});
