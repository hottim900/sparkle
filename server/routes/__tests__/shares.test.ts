import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
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
  sqlite.pragma("foreign_keys = ON");

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

    CREATE TABLE share_tokens (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      visibility TEXT NOT NULL DEFAULT 'unlisted',
      created TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_share_tokens_token ON share_tokens(token);
    CREATE INDEX idx_share_tokens_item_id ON share_tokens(item_id);
  `);

  setupFTS(sqlite);

  return { db: drizzle(sqlite, { schema }), sqlite };
}

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
import { sharesRouter } from "../shares.js";
import { publicRouter } from "../public.js";
import { itemsRouter } from "../items.js";

const TEST_TOKEN = "test-secret-token-12345";

function createApp() {
  const app = new Hono();
  app.use("/api/*", authMiddleware);
  app.route("/api/items", itemsRouter);
  app.route("/api", sharesRouter);
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

function insertNote(
  overrides: Partial<{
    id: string;
    type: string;
    title: string;
    content: string;
    status: string;
    tags: string;
  }> = {},
) {
  const id = overrides.id ?? "note-1";
  const now = new Date().toISOString();
  testSqlite
    .prepare(
      "INSERT INTO items (id, type, title, content, status, tags, created, modified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      overrides.type ?? "note",
      overrides.title ?? "Test Note",
      overrides.content ?? "# Hello\n\nThis is **bold** text.",
      overrides.status ?? "fleeting",
      overrides.tags ?? '["test","share"]',
      now,
      now,
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
// Shares CRUD (Authenticated Routes)
// ============================================================
describe("Shares CRUD", () => {
  describe("POST /api/items/:id/share", () => {
    it("creates a share and returns 201", async () => {
      const noteId = insertNote();
      const res = await app.request(`/api/items/${noteId}/share`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "unlisted" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.share).toBeDefined();
      expect(body.share.item_id).toBe(noteId);
      expect(body.share.visibility).toBe("unlisted");
      expect(body.share.token).toBeTruthy();
      expect(body.url).toBe(`/s/${body.share.token}`);
    });

    it("creates a public share", async () => {
      const noteId = insertNote();
      const res = await app.request(`/api/items/${noteId}/share`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "public" }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.share.visibility).toBe("public");
    });

    it("defaults visibility to unlisted", async () => {
      const noteId = insertNote();
      const res = await app.request(`/api/items/${noteId}/share`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.share.visibility).toBe("unlisted");
    });

    it("returns 404 for non-existent item", async () => {
      const res = await app.request("/api/items/nonexistent/share", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "unlisted" }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/not found/i);
    });

    it("returns 400 for todo items", async () => {
      insertNote({ id: "todo-1", type: "todo", status: "active" });
      const res = await app.request("/api/items/todo-1/share", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "unlisted" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/only notes/i);
    });

    it("returns 400 for scratch items", async () => {
      insertNote({ id: "scratch-1", type: "scratch", status: "draft" });
      const res = await app.request("/api/items/scratch-1/share", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "unlisted" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/only notes/i);
    });

    it("returns 400 for invalid visibility value", async () => {
      const noteId = insertNote();
      const res = await app.request(`/api/items/${noteId}/share`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "invalid" }),
      });
      expect(res.status).toBe(400);
    });

    it("requires auth", async () => {
      const noteId = insertNote();
      const res = await app.request(`/api/items/${noteId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: "unlisted" }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/shares", () => {
    it("lists all shares", async () => {
      const noteId = insertNote();
      // Create two shares
      await app.request(`/api/items/${noteId}/share`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "unlisted" }),
      });
      await app.request(`/api/items/${noteId}/share`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "public" }),
      });

      const res = await app.request("/api/shares", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.shares).toHaveLength(2);
      expect(body.shares[0].item_title).toBe("Test Note");
    });

    it("returns empty array when no shares", async () => {
      const res = await app.request("/api/shares", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.shares).toHaveLength(0);
    });

    it("requires auth", async () => {
      const res = await app.request("/api/shares");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/items/:id/shares", () => {
    it("lists shares for a specific item", async () => {
      const noteId = insertNote();
      insertNote({ id: "note-2", title: "Other Note" });

      await app.request(`/api/items/${noteId}/share`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "unlisted" }),
      });
      await app.request("/api/items/note-2/share", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "public" }),
      });

      const res = await app.request(`/api/items/${noteId}/shares`, {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.shares).toHaveLength(1);
      expect(body.shares[0].item_id).toBe(noteId);
    });
  });

  describe("DELETE /api/shares/:id", () => {
    it("revokes a share", async () => {
      const noteId = insertNote();
      const createRes = await app.request(`/api/items/${noteId}/share`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "unlisted" }),
      });
      const { share } = await createRes.json();

      const res = await app.request(`/api/shares/${share.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      // Verify it's gone
      const listRes = await app.request("/api/shares", {
        headers: authHeaders(),
      });
      const listBody = await listRes.json();
      expect(listBody.shares).toHaveLength(0);
    });

    it("returns 404 for non-existent share", async () => {
      const res = await app.request("/api/shares/nonexistent", {
        method: "DELETE",
        headers: authHeaders(),
      });
      expect(res.status).toBe(404);
    });

    it("requires auth", async () => {
      const res = await app.request("/api/shares/some-id", {
        method: "DELETE",
      });
      expect(res.status).toBe(401);
    });
  });
});

// ============================================================
// Public API Routes (No Auth Required)
// ============================================================
describe("Public API", () => {
  describe("GET /api/public/:token", () => {
    it("returns shared note without auth", async () => {
      const noteId = insertNote({
        content: "# Hello\n\nWorld",
        tags: '["tag1","tag2"]',
      });
      const createRes = await app.request(`/api/items/${noteId}/share`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "unlisted" }),
      });
      const { share } = await createRes.json();

      const res = await app.request(`/api/public/${share.token}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe("Test Note");
      expect(body.content).toBe("# Hello\n\nWorld");
      expect(body.tags).toEqual(["tag1", "tag2"]);
      expect(body.visibility).toBe("unlisted");
      expect(body.created).toBeTruthy();
      expect(body.modified).toBeTruthy();
    });

    it("does not expose sensitive fields", async () => {
      const noteId = insertNote();
      const createRes = await app.request(`/api/items/${noteId}/share`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "unlisted" }),
      });
      const { share } = await createRes.json();

      const res = await app.request(`/api/public/${share.token}`);
      const body = await res.json();
      expect(body.priority).toBeUndefined();
      expect(body.due).toBeUndefined();
      expect(body.linked_note_id).toBeUndefined();
      expect(body.origin).toBeUndefined();
      expect(body.aliases).toBeUndefined();
      expect(body.id).toBeUndefined();
    });

    it("returns 404 for invalid token", async () => {
      const res = await app.request("/api/public/invalid-token");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/not found/i);
    });

    it("returns 404 after share is revoked", async () => {
      const noteId = insertNote();
      const createRes = await app.request(`/api/items/${noteId}/share`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "unlisted" }),
      });
      const { share } = await createRes.json();

      // Revoke
      await app.request(`/api/shares/${share.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });

      // Try to access
      const res = await app.request(`/api/public/${share.token}`);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/public", () => {
    it("lists only public shares", async () => {
      const noteId = insertNote();
      insertNote({ id: "note-2", title: "Public Note" });

      await app.request(`/api/items/${noteId}/share`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "unlisted" }),
      });
      await app.request("/api/items/note-2/share", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ visibility: "public" }),
      });

      const res = await app.request("/api/public");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.shares).toHaveLength(1);
      expect(body.shares[0].title).toBe("Public Note");
      expect(body.shares[0].token).toBeTruthy();
    });

    it("does not require auth", async () => {
      const res = await app.request("/api/public");
      expect(res.status).toBe(200);
    });
  });
});

// ============================================================
// SSR Public Page (GET /s/:token)
// ============================================================
describe("SSR Public Page", () => {
  it("renders HTML with correct content type", async () => {
    const noteId = insertNote({ content: "# Hello World" });
    const createRes = await app.request(`/api/items/${noteId}/share`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ visibility: "unlisted" }),
    });
    const { share } = await createRes.json();

    const res = await app.request(`/s/${share.token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
  });

  it("renders note title and content as markdown", async () => {
    const noteId = insertNote({
      title: "My Shared Note",
      content: "# Heading\n\nSome **bold** text.",
    });
    const createRes = await app.request(`/api/items/${noteId}/share`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ visibility: "unlisted" }),
    });
    const { share } = await createRes.json();

    const res = await app.request(`/s/${share.token}`);
    const html = await res.text();
    expect(html).toContain("My Shared Note");
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("includes OpenGraph meta tags", async () => {
    const noteId = insertNote({
      title: "OG Test Note",
      content: "This is the description content.",
    });
    const createRes = await app.request(`/api/items/${noteId}/share`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ visibility: "unlisted" }),
    });
    const { share } = await createRes.json();

    const res = await app.request(`/s/${share.token}`);
    const html = await res.text();
    expect(html).toContain("og:title");
    expect(html).toContain("OG Test Note");
    expect(html).toContain("og:description");
    expect(html).toContain("This is the description content.");
  });

  it("renders tags", async () => {
    const noteId = insertNote({ tags: '["javascript","notes"]' });
    const createRes = await app.request(`/api/items/${noteId}/share`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ visibility: "unlisted" }),
    });
    const { share } = await createRes.json();

    const res = await app.request(`/s/${share.token}`);
    const html = await res.text();
    expect(html).toContain("javascript");
    expect(html).toContain("notes");
  });

  it("returns 404 HTML for invalid token", async () => {
    const res = await app.request("/s/invalid-token");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain("404");
  });

  it("returns 404 after share is revoked", async () => {
    const noteId = insertNote();
    const createRes = await app.request(`/api/items/${noteId}/share`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ visibility: "unlisted" }),
    });
    const { share } = await createRes.json();

    await app.request(`/api/shares/${share.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });

    const res = await app.request(`/s/${share.token}`);
    expect(res.status).toBe(404);
  });

  it("does not require auth", async () => {
    const noteId = insertNote();
    const createRes = await app.request(`/api/items/${noteId}/share`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ visibility: "unlisted" }),
    });
    const { share } = await createRes.json();

    // Access without auth header
    const res = await app.request(`/s/${share.token}`);
    expect(res.status).toBe(200);
  });

  it("escapes HTML in title to prevent XSS", async () => {
    const noteId = insertNote({
      title: '<script>alert("xss")</script>',
    });
    const createRes = await app.request(`/api/items/${noteId}/share`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ visibility: "unlisted" }),
    });
    const { share } = await createRes.json();

    const res = await app.request(`/s/${share.token}`);
    const html = await res.text();
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain("&lt;script&gt;");
  });

  it("does not load SPA JavaScript bundle", async () => {
    const noteId = insertNote();
    const createRes = await app.request(`/api/items/${noteId}/share`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ visibility: "unlisted" }),
    });
    const { share } = await createRes.json();

    const res = await app.request(`/s/${share.token}`);
    const html = await res.text();
    // Should not reference any JS bundle
    expect(html).not.toMatch(/src=.*\.js/);
    expect(html).not.toContain('type="module"');
  });
});
