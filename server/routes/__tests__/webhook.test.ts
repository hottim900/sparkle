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

// Now import modules that depend on the mocked db
import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { webhookRouter } from "../webhook.js";
import { items } from "../../db/schema.js";
import { updateSettings } from "../../lib/settings.js";

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
    expect(allItems[0].status).toBe("fleeting");
    expect(allItems[0].origin).toBe("LINE");
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
      INSERT INTO items (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified) VALUES
        ('id-1', 'todo', '買牛奶', '', 'active', NULL, NULL, '[]', 'LINE', NULL, '[]', '${now}', '${now}'),
        ('id-2', 'note', '研究 Hono', '', 'fleeting', NULL, NULL, '[]', 'LINE', NULL, '[]', '${now}', '${now}'),
        ('id-3', 'todo', '繳電費', '', 'active', 'high', '${yesterdayStr}', '[]', '', NULL, '[]', '${now}', '${now}'),
        ('id-4', 'todo', '開會準備', '', 'active', NULL, '${todayStr}', '[]', '', NULL, '[]', '${now}', '${now}'),
        ('id-5', 'todo', '牛奶品牌比較', '', 'active', NULL, NULL, '[]', '', NULL, '[]', '${now}', '${now}'),
        ('id-6', 'note', '讀書筆記', '', 'permanent', NULL, NULL, '[]', '', NULL, '[]', '${now}', '${now}');
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
      expect(replyText).toContain("閃念");
      expect(replyText).toContain("研究 Hono");
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
      expect(callBody.messages[0].text).toContain("沒有閃念筆記");
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
        INSERT INTO items (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified) VALUES
          ('id-f1', 'note', 'Hono middleware research', '', 'fleeting', NULL, NULL, '[]', 'LINE', NULL, '[]', '${now}', '${now}'),
          ('id-f2', 'todo', 'Hono framework setup', '', 'active', NULL, NULL, '[]', '', NULL, '[]', '${now}', '${now}');
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
      expect(replyText).toContain("閃念: 1");
      expect(replyText).toContain("永久: 1");
      expect(replyText).toContain("進行中: 4");
      expect(replyText).toContain("逾期: 1");
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
      expect(replyText).toContain("!fleeting");
      expect(replyText).toContain("!developing");
      expect(replyText).toContain("!permanent");
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
      expect(replyText).toContain("!develop");
      expect(replyText).toContain("!mature");
      expect(replyText).toContain("!export");
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
      expect(callBody.messages[0].text).toContain("沒有進行中的待辦");
    });
  });

  describe("!list command", () => {
    it("returns items filtered by tag", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      const now = new Date().toISOString();
      testSqlite.exec(`
        INSERT INTO items (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified) VALUES
          ('id-t1', 'todo', '寫報告', '', 'active', NULL, NULL, '["工作"]', '', NULL, '[]', '${now}', '${now}'),
          ('id-t2', 'todo', '回信', '', 'active', NULL, NULL, '["工作","重要"]', '', NULL, '[]', '${now}', '${now}');
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

      // Establish session with todos (not notes — notes don't support due)
      await sendLineMessage(app, "!active");
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
      const updated = allItems.find((i) => i.due === "2026-03-15");
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

      await sendLineMessage(app, "!active");
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

    it("rejects due on notes", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // Query fleeting notes to get a note in session
      await sendLineMessage(app, "!fleeting");
      vi.mocked(fetch).mockClear();

      // Try to set due on the note
      const res = await sendLineMessage(app, "!due 1 2026-03-15");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("只適用於待辦");
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
        INSERT INTO items (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified) VALUES
          ('id-dup', 'todo', '有標籤的項目', '', 'active', NULL, NULL, '["工作"]', '', NULL, '[]', '${now}', '${now}');
      `);

      await sendLineMessage(app, "!active");
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

      // Verify at least one item is now done
      const doneItems = testSqlite.prepare("SELECT * FROM items WHERE status = 'done'").all() as any[];
      expect(doneItems.length).toBeGreaterThanOrEqual(1);
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
      const highItems = testSqlite.prepare("SELECT * FROM items WHERE priority = 'high' AND status = 'fleeting'").all() as any[];
      expect(highItems.length).toBeGreaterThanOrEqual(1);
    });

    it("clears priority with none", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // Query today focus (id-3 is overdue, appears first)
      await sendLineMessage(app, "!today");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!priority 1 none");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("已清除");

      // Verify DB state - id-3 (繳電費) is the first focus item (overdue)
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
        INSERT INTO items (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified) VALUES
          ('id-ut1', 'todo', '有很多標籤', '', 'active', NULL, NULL, '["工作","個人","重要"]', '', NULL, '[]', '${now}', '${now}');
      `);

      await sendLineMessage(app, "!active");
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
    it("query results use [N] format", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      await sendLineMessage(app, "!active");

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

  // ============================================================
  // Zettelkasten command tests
  // ============================================================

  describe("!develop command", () => {
    it("promotes fleeting note to developing", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // Establish session with fleeting notes (id-2 is fleeting)
      await sendLineMessage(app, "!fleeting");
      vi.mocked(fetch).mockClear();

      // Develop first item
      const res = await sendLineMessage(app, "!develop 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("發展中");

      // Verify DB
      const item = testSqlite.prepare("SELECT status FROM items WHERE id = ?").get("id-2") as any;
      expect(item.status).toBe("developing");
    });

    it("rejects todo items", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // Establish session with active todos
      await sendLineMessage(app, "!active");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!develop 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("此指令只適用於筆記");
    });

    it("rejects non-fleeting notes", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // Establish session with permanent notes (id-6 is permanent)
      await sendLineMessage(app, "!permanent");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!develop 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("無法執行此操作");
    });
  });

  describe("!mature command", () => {
    it("promotes developing note to permanent", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // Update id-2 to developing directly
      testSqlite.exec("UPDATE items SET status='developing' WHERE id='id-2'");

      // Establish session with developing notes
      await sendLineMessage(app, "!developing");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!mature 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("永久筆記");

      // Verify DB
      const item = testSqlite.prepare("SELECT status FROM items WHERE id = ?").get("id-2") as any;
      expect(item.status).toBe("permanent");
    });

    it("rejects todo items", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      await sendLineMessage(app, "!active");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!mature 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("此指令只適用於筆記");
    });
  });

  describe("!export command", () => {
    it("rejects when Obsidian export not configured", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      // Default settings: obsidian_enabled=false
      seedItems();

      // id-6 is permanent
      await sendLineMessage(app, "!permanent");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!export 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("Obsidian 匯出未設定");
    });

    it("rejects non-permanent notes", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // id-2 is fleeting
      await sendLineMessage(app, "!fleeting");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!export 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("只有永久筆記可以匯出");
    });

    it("exports permanent note to Obsidian vault", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // Set up temp dir for Obsidian vault
      const os = await import("node:os");
      const fs = await import("node:fs");
      const path = await import("node:path");
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sparkle-test-"));

      // Enable obsidian export via DB settings
      updateSettings(testSqlite, {
        obsidian_enabled: "true",
        obsidian_vault_path: tmpDir,
      });

      try {
        // id-6 is permanent
        await sendLineMessage(app, "!permanent");
        vi.mocked(fetch).mockClear();

        const res = await sendLineMessage(app, "!export 1");
        expect(res.status).toBe(200);

        const fetchMock = vi.mocked(fetch);
        const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
        expect(callBody.messages[0].text).toContain("已匯出到 Obsidian");
      } finally {
        // Cleanup
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("!done on non-todo (rejection)", () => {
    it("rejects !done on a note", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      await sendLineMessage(app, "!fleeting");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!done 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("只適用於待辦");
    });

    it("rejects !done on a scratch item", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      const now = new Date().toISOString();
      testSqlite.exec(`
        INSERT INTO items (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified) VALUES
          ('id-scratch-done', 'scratch', 'scratch done test', '', 'draft', NULL, NULL, '[]', 'LINE', NULL, '[]', '${now}', '${now}');
      `);

      await sendLineMessage(app, "!scratch");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!done 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("只適用於待辦");
    });
  });

  describe("!due on non-todo (rejection)", () => {
    it("rejects !due on a scratch item", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      const now = new Date().toISOString();
      testSqlite.exec(`
        INSERT INTO items (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified) VALUES
          ('id-scratch-due', 'scratch', 'scratch due test', '', 'draft', NULL, NULL, '[]', 'LINE', NULL, '[]', '${now}', '${now}');
      `);

      await sendLineMessage(app, "!scratch");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!due 1 明天");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("只適用於待辦");
    });
  });

  describe("!developing query", () => {
    it("returns empty message when no developing notes", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // No developing items in seed data
      const res = await sendLineMessage(app, "!developing");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("沒有發展中的筆記");
    });
  });

  describe("!permanent query", () => {
    it("returns permanent notes", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // id-6 is permanent
      const res = await sendLineMessage(app, "!permanent");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("讀書筆記");
    });
  });

  describe("!track command", () => {
    it("creates linked todo from note", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // First query notes to establish session (id-2 is note '研究 Hono')
      await sendLineMessage(app, "!fleeting");

      const fetchMock = vi.mocked(fetch);
      fetchMock.mockClear();

      // Track the first item in session (should be the note)
      const res = await sendLineMessage(app, "!track 1");
      expect(res.status).toBe(200);

      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("已建立追蹤待辦");
      expect(replyText).toContain("處理：研究 Hono");

      // Verify the linked todo was created in the database
      const allItems = testDb.select().from(items).all();
      const linkedTodo = allItems.find((i: Record<string, unknown>) => i.linked_note_id === "id-2");
      expect(linkedTodo).toBeTruthy();
      expect(linkedTodo!.type).toBe("todo");
      expect(linkedTodo!.title).toBe("處理：研究 Hono");
    });

    it("creates linked todo with due date", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // Query notes to establish session
      await sendLineMessage(app, "!fleeting");

      const fetchMock = vi.mocked(fetch);
      fetchMock.mockClear();

      const res = await sendLineMessage(app, "!track 1 2026-03-15");
      expect(res.status).toBe(200);

      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("已建立追蹤待辦");
      expect(replyText).toContain("2026-03-15");

      // Verify the linked todo has due date
      const allItems = testDb.select().from(items).all();
      const linkedTodo = allItems.find((i: Record<string, unknown>) => i.linked_note_id === "id-2");
      expect(linkedTodo).toBeTruthy();
      expect(linkedTodo!.due).toBe("2026-03-15");
    });

    it("rejects !track on a todo item", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // Query active todos to establish session (all are todos)
      await sendLineMessage(app, "!active");

      const fetchMock = vi.mocked(fetch);
      fetchMock.mockClear();

      const res = await sendLineMessage(app, "!track 1");
      expect(res.status).toBe(200);

      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("此指令只適用於筆記");
    });

    it("returns error for !track without session", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!track 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("不存在");
    });
  });

  // ============================================================
  // Scratch command tests
  // ============================================================

  describe("!scratch command", () => {
    it("lists draft scratch items", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      const now = new Date().toISOString();
      testSqlite.exec(`
        INSERT INTO items (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified) VALUES
          ('id-s1', 'scratch', 'temp note 1', '', 'draft', NULL, NULL, '[]', 'LINE', NULL, '[]', '${now}', '${now}'),
          ('id-s2', 'scratch', 'temp note 2', '', 'draft', NULL, NULL, '[]', 'LINE', NULL, '[]', '${now}', '${now}');
      `);

      const res = await sendLineMessage(app, "!scratch");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("暫存");
      expect(replyText).toContain("temp note");
      expect(callBody.messages[0].quickReply).toBeDefined();
    });

    it("returns empty message when no scratch items", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!scratch");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("沒有暫存項目");
    });

    it("!s works as alias for !scratch", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!s");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("沒有暫存項目");
    });
  });

  describe("!tmp command", () => {
    it("creates scratch item via !tmp", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!tmp quick note");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("暫存");
      expect(replyText).toContain("quick note");

      // Verify item was created as scratch with draft status
      const allItems = testDb.select().from(items).all();
      expect(allItems).toHaveLength(1);
      expect(allItems[0].type).toBe("scratch");
      expect(allItems[0].status).toBe("draft");
      expect(allItems[0].title).toBe("quick note");
    });
  });

  describe("!delete command", () => {
    it("hard deletes item after query session", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      const now = new Date().toISOString();
      testSqlite.exec(`
        INSERT INTO items (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified) VALUES
          ('id-d1', 'scratch', 'deletable note', '', 'draft', NULL, NULL, '[]', 'LINE', NULL, '[]', '${now}', '${now}');
      `);

      // Establish session
      await sendLineMessage(app, "!scratch");
      vi.mocked(fetch).mockClear();

      // Delete first item
      const res = await sendLineMessage(app, "!delete 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("已刪除");
      expect(replyText).toContain("deletable note");

      // Verify item was actually deleted from DB
      const allItems = testDb.select().from(items).all();
      expect(allItems).toHaveLength(0);
    });

    it("returns error when no session exists", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!delete 1", "no-session-user");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("不存在");
    });
  });

  describe("!upgrade command", () => {
    it("converts scratch to fleeting note", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      const now = new Date().toISOString();
      testSqlite.exec(`
        INSERT INTO items (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified) VALUES
          ('id-u1', 'scratch', 'upgrade me', '', 'draft', NULL, NULL, '[]', 'LINE', NULL, '[]', '${now}', '${now}');
      `);

      // Establish session
      await sendLineMessage(app, "!scratch");
      vi.mocked(fetch).mockClear();

      // Upgrade first item
      const res = await sendLineMessage(app, "!upgrade 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      const replyText: string = callBody.messages[0].text;
      expect(replyText).toContain("升級為閃念筆記");
      expect(replyText).toContain("upgrade me");

      // Verify DB: type changed to note, status auto-mapped to fleeting
      const item = testSqlite.prepare("SELECT type, status FROM items WHERE id = ?").get("id-u1") as any;
      expect(item.type).toBe("note");
      expect(item.status).toBe("fleeting");
    });

    it("rejects non-scratch items", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;
      seedItems();

      // Establish session with notes (id-2 is a note)
      await sendLineMessage(app, "!fleeting");
      vi.mocked(fetch).mockClear();

      const res = await sendLineMessage(app, "!upgrade 1");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("此指令只適用於暫存項目");
    });

    it("returns error when no session exists", async () => {
      process.env.LINE_CHANNEL_SECRET = TEST_LINE_SECRET;
      process.env.LINE_CHANNEL_ACCESS_TOKEN = TEST_LINE_ACCESS_TOKEN;

      const res = await sendLineMessage(app, "!upgrade 1", "no-session-user");
      expect(res.status).toBe(200);

      const fetchMock = vi.mocked(fetch);
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(callBody.messages[0].text).toContain("不存在");
    });
  });
});
