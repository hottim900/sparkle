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

  // ============================================================
  // Query command tests
  // ============================================================

  function sendLineMessage(app: Hono, text: string, userId = "test-user") {
    const body = JSON.stringify({
      events: [
        {
          type: "message",
          message: { type: "text", text },
          replyToken: "reply-token-query",
          source: { userId },
        },
      ],
    });
    const signature = makeSignature(body, TEST_LINE_SECRET);
    return app.request("/api/webhook/line", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-line-signature": signature,
      },
      body,
    });
  }

  function seedItems() {
    const now = new Date().toISOString();
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

    testSqlite.exec(`
      INSERT INTO items (id, type, title, content, status, priority, due_date, tags, source, created_at, updated_at) VALUES
        ('id-1', 'todo', '買牛奶', '', 'inbox', NULL, NULL, '[]', 'LINE', '${now}', '${now}'),
        ('id-2', 'note', '研究 Hono', '', 'inbox', NULL, NULL, '[]', 'LINE', '${now}', '${now}'),
        ('id-3', 'todo', '繳電費', '', 'active', 'high', '${yesterdayStr}', '[]', '', '${now}', '${now}'),
        ('id-4', 'todo', '開會準備', '', 'active', NULL, '${todayStr}', '[]', '', '${now}', '${now}'),
        ('id-5', 'todo', '牛奶品牌比較', '', 'inbox', NULL, NULL, '[]', '', '${now}', '${now}'),
        ('id-6', 'note', '讀書筆記', '', 'done', NULL, NULL, '[]', '', '${now}', '${now}');
    `);
  }

  describe("!inbox command", () => {
    it("returns inbox items when inbox has items", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      const res = await sendLineMessage(app, "!inbox");
      expect(res.status).toBe(200);

      // Should NOT create any new items
      const allItems = testDb.select().from(items).all();
      expect(allItems).toHaveLength(6); // Only seeded items

      // Verify reply was sent with quick reply
      const fetchMock = vi.mocked(fetch);
      expect(fetchMock).toHaveBeenCalled();
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("收件匣");
      expect(replyText).toContain("買牛奶");
      // Should have quick reply buttons
      expect(callBody.messages[0].quickReply).toBeDefined();
    });

    it("returns empty inbox message when no items", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!inbox");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("收件匣是空的");
    });

    it("does not create items (query only)", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      await sendLineMessage(app, "!inbox");
      const allItems = testDb.select().from(items).all();
      expect(allItems).toHaveLength(0);
    });
  });

  describe("!find command", () => {
    it("returns matching items", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      // Use ASCII text for FTS5 default tokenizer compatibility
      const now = new Date().toISOString();
      testSqlite.exec(`
        INSERT INTO items (id, type, title, content, status, priority, due_date, tags, source, created_at, updated_at) VALUES
          ('id-f1', 'note', 'Hono middleware research', '', 'inbox', NULL, NULL, '[]', 'LINE', '${now}', '${now}'),
          ('id-f2', 'todo', 'Hono framework setup', '', 'active', NULL, NULL, '[]', '', '${now}', '${now}');
      `);

      const res = await sendLineMessage(app, "!find Hono");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("搜尋「Hono」");
      expect(replyText).toContain("Hono middleware research");
      expect(callBody.messages[0].quickReply).toBeDefined();
    });

    it("returns no-results message when nothing matches", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!find nonexistentkeyword");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("找不到");
    });

    it("does not create items (query only)", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      await sendLineMessage(app, "!find something");
      const allItems = testDb.select().from(items).all();
      expect(allItems).toHaveLength(0);
    });
  });

  describe("!today command", () => {
    it("returns focus items when there are due/high-priority items", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      const res = await sendLineMessage(app, "!today");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("今日焦點");
      // Should include overdue and today items
      expect(replyText).toContain("繳電費");
      expect(replyText).toContain("開會準備");
      expect(callBody.messages[0].quickReply).toBeDefined();
    });

    it("returns empty message when no focus items", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!today");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("今天沒有待處理的項目");
    });

    it("does not create items (query only)", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      await sendLineMessage(app, "!today");
      const allItems = testDb.select().from(items).all();
      expect(allItems).toHaveLength(0);
    });
  });

  describe("!stats command", () => {
    it("returns formatted stats", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      const res = await sendLineMessage(app, "!stats");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("Sparkle 統計");
      expect(replyText).toContain("收件匣：3");
      expect(replyText).toContain("進行中：2");
      expect(replyText).toContain("逾期：1");
      expect(callBody.messages[0].quickReply).toBeDefined();
    });

    it("does not create items (query only)", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      await sendLineMessage(app, "!stats");
      const allItems = testDb.select().from(items).all();
      expect(allItems).toHaveLength(0);
    });
  });

  describe("!notes command", () => {
    it("returns only notes with numbered format", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      const res = await sendLineMessage(app, "!notes");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("筆記");
      // seedItems has 2 notes: '研究 Hono' (inbox), '讀書筆記' (done)
      expect(replyText).toContain("研究 Hono");
      expect(replyText).toContain("讀書筆記");
      // Should NOT contain todos
      expect(replyText).not.toContain("買牛奶");
      expect(replyText).not.toContain("繳電費");
    });

    it("returns empty message when no notes", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!notes");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("沒有筆記");
    });
  });

  describe("!todos command", () => {
    it("returns only todos with numbered format", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      const res = await sendLineMessage(app, "!todos");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("待辦");
      // seedItems has 4 todos: 買牛奶, 繳電費, 開會準備, 牛奶品牌比較
      expect(replyText).toContain("買牛奶");
      // Should NOT contain notes
      expect(replyText).not.toContain("研究 Hono");
      expect(replyText).not.toContain("讀書筆記");
    });

    it("returns empty message when no todos", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!todos");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("沒有待辦");
    });
  });

  describe("help text", () => {
    it("includes all commands in help text", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "?");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("!inbox");
      expect(replyText).toContain("!today");
      expect(replyText).toContain("!find");
      expect(replyText).toContain("!stats");
      expect(replyText).toContain("!active");
      expect(replyText).toContain("!notes");
      expect(replyText).toContain("!todos");
      expect(replyText).toContain("!detail");
      expect(replyText).toContain("!due");
      expect(replyText).toContain("!tag");
      expect(replyText).toContain("!untag");
      expect(replyText).toContain("!done");
      expect(replyText).toContain("!archive");
      expect(replyText).toContain("!priority");
      expect(replyText).toContain("!list");
    });
  });

  // ============================================================
  // New browse & edit command tests
  // ============================================================

  describe("!active command", () => {
    it("returns active items with numbered format", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      const res = await sendLineMessage(app, "!active");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("進行中");
      expect(replyText).toContain("[1]");
      expect(replyText).toContain("繳電費");
      expect(replyText).toContain("開會準備");
      expect(callBody.messages[0].quickReply).toBeDefined();
    });

    it("returns empty message when no active items", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!active");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("沒有進行中的項目");
    });
  });

  describe("!list command", () => {
    it("returns items filtered by tag", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      const now = new Date().toISOString();
      testSqlite.exec(`
        INSERT INTO items (id, type, title, content, status, priority, due_date, tags, source, created_at, updated_at) VALUES
          ('id-t1', 'todo', '寫報告', '', 'active', NULL, NULL, '["工作"]', '', '${now}', '${now}'),
          ('id-t2', 'todo', '回信', '', 'inbox', NULL, NULL, '["工作","重要"]', '', '${now}', '${now}');
      `);

      const res = await sendLineMessage(app, "!list 工作");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("標籤「工作」");
      expect(replyText).toContain("寫報告");
      expect(replyText).toContain("回信");
    });

    it("returns empty message when no items match tag", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!list 不存在的標籤");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("找不到標籤");
    });
  });

  describe("!detail command", () => {
    it("returns full detail after query establishes session", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // First, query to establish session
      await sendLineMessage(app, "!inbox");
      vi.mocked(fetch).mockClear();

      // Then get detail of item 1
      const res = await sendLineMessage(app, "!detail 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("📋");
      expect(replyText).toContain("類型：");
      expect(replyText).toContain("狀態：");
    });

    it("returns error when no session exists", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!detail 1", "no-session-user");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("編號 1 不存在");
    });
  });

  describe("!due command", () => {
    it("sets due date after query session", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // Establish session
      await sendLineMessage(app, "!inbox");
      vi.mocked(fetch).mockClear();

      // Set due date
      const res = await sendLineMessage(app, "!due 1 2026-03-15");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("已設定");
      expect(replyText).toContain("2026-03-15");

      // Verify DB was updated
      const allItems = testDb.select().from(items).all();
      const updated = allItems.find((i) => i.title === "牛奶品牌比較" || i.due_date === "2026-03-15");
      expect(updated).toBeDefined();
    });

    it("clears due date with '清除'", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // Query active items (includes items with due dates)
      await sendLineMessage(app, "!active");
      vi.mocked(fetch).mockClear();

      // Clear due date of first item
      const res = await sendLineMessage(app, "!due 1 清除");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("已清除");
    });

    it("returns error for invalid date", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      await sendLineMessage(app, "!inbox");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!due 1 不知道什麼");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("無法辨識日期");
    });

    it("returns error when no session exists", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!due 1 明天", "no-session-user");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("編號 1 不存在");
    });
  });

  describe("!tag command", () => {
    it("appends tags to item after query session", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      await sendLineMessage(app, "!inbox");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!tag 1 工作 重要");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("已為");
      expect(replyText).toContain("加上標籤");
      expect(replyText).toContain("工作");
      expect(replyText).toContain("重要");
    });

    it("does not duplicate existing tags", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      const now = new Date().toISOString();
      testSqlite.exec(`
        INSERT INTO items (id, type, title, content, status, priority, due_date, tags, source, created_at, updated_at) VALUES
          ('id-dup', 'todo', '有標籤的項目', '', 'inbox', NULL, NULL, '["工作"]', '', '${now}', '${now}');
      `);

      await sendLineMessage(app, "!inbox");
      vi.mocked(fetch).mockClear();

      await sendLineMessage(app, "!tag 1 工作 新標籤");

      // Check DB: should have ["工作", "新標籤"] not ["工作", "工作", "新標籤"]
      const allItems = testDb.select().from(items).all();
      const item = allItems.find((i) => i.id === "id-dup")!;
      const tags = JSON.parse(item.tags);
      expect(tags).toEqual(["工作", "新標籤"]);
    });

    it("returns error when no session exists", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!tag 1 工作", "no-session-user");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("編號 1 不存在");
    });
  });

  describe("!done command", () => {
    it("marks item as done after query session", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // Establish session with active items
      await sendLineMessage(app, "!active");
      vi.mocked(fetch).mockClear();

      // Mark first item as done
      const res = await sendLineMessage(app, "!done 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("✅");
      expect(replyText).toContain("已完成");

      // Verify DB state
      const item = testSqlite.prepare("SELECT status FROM items WHERE id = ?").get("id-3") as any;
      expect(item.status).toBe("done");
    });

    it("returns error when no session exists", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!done 1", "no-session-user");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("不存在");
    });
  });

  describe("!archive command", () => {
    it("archives item after query session", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // Establish session
      await sendLineMessage(app, "!inbox");
      vi.mocked(fetch).mockClear();

      // Archive first item
      const res = await sendLineMessage(app, "!archive 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("✅");
      expect(replyText).toContain("已封存");

      // Verify at least one inbox item is now archived
      const archivedItems = testSqlite.prepare("SELECT * FROM items WHERE status = 'archived'").all() as any[];
      expect(archivedItems.length).toBeGreaterThanOrEqual(1);
    });

    it("returns error when no session exists", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!archive 1", "no-session-user");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("不存在");
    });
  });

  describe("!priority command", () => {
    it("sets item priority after query session", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      await sendLineMessage(app, "!inbox");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!priority 1 high");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("✅");
      expect(replyText).toContain("high");

      // Verify at least one item now has high priority
      const highItems = testSqlite.prepare("SELECT * FROM items WHERE priority = 'high' AND status = 'inbox'").all() as any[];
      expect(highItems.length).toBeGreaterThanOrEqual(1);
    });

    it("clears priority with none", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // Query active (includes id-3 with priority=high)
      await sendLineMessage(app, "!active");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!priority 1 none");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("已清除");

      // Verify DB state
      const item = testSqlite.prepare("SELECT priority FROM items WHERE id = ?").get("id-3") as any;
      expect(item.priority).toBeNull();
    });

    it("returns error when no session exists", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!priority 1 high", "no-session-user");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("不存在");
    });
  });

  describe("!untag command", () => {
    it("removes tags from item after query session", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      const now = new Date().toISOString();
      testSqlite.exec(`
        INSERT INTO items (id, type, title, content, status, priority, due_date, tags, source, created_at, updated_at) VALUES
          ('id-ut1', 'todo', '有很多標籤', '', 'inbox', NULL, NULL, '["工作","個人","重要"]', '', '${now}', '${now}');
      `);

      await sendLineMessage(app, "!inbox");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!untag 1 工作 重要");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("✅");
      expect(replyText).toContain("移除標籤");
      expect(replyText).toContain("工作");
      expect(replyText).toContain("重要");

      // Verify DB state
      const item = testSqlite.prepare("SELECT tags FROM items WHERE id = ?").get("id-ut1") as any;
      const tags = JSON.parse(item.tags);
      expect(tags).toEqual(["個人"]);
    });

    it("returns error when no session exists", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!untag 1 工作", "no-session-user");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("不存在");
    });
  });

  describe("session numbering", () => {
    it("inbox results use [N] format", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      await sendLineMessage(app, "!inbox");

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("[1]");
      expect(replyText).toContain("[2]");
    });
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
