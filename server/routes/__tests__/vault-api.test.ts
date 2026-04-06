import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb } from "../../test-utils.js";

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
import { vaultRouter } from "../vault.js";
import { vaultFiles } from "../../db/schema.js";

function enableObsidian(sqlite: Database.Database, vaultPath: string) {
  sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'obsidian_enabled'").run("true");
  sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'obsidian_vault_path'").run(vaultPath);
}

describe("vault API", () => {
  let app: InstanceType<typeof Hono>;

  beforeEach(() => {
    const t = createTestDb();
    testSqlite = t.sqlite;
    testDb = t.db;
    enableObsidian(testSqlite, "/tmp/test-vault");

    app = new Hono();
    app.route("/api/vault", vaultRouter);

    // Insert some test vault files
    t.db
      .insert(vaultFiles)
      .values([
        {
          path: "notes/test.md",
          title: "Test Note",
          content: "Hello world content",
          mtime: 1700000000,
          content_hash: "hash1",
          sparkle_id: "aaaaaaaa-1111-4222-8333-444444444444",
        },
        {
          path: "notes/中文筆記.md",
          title: "中文筆記",
          content: "這是一篇中文的測試筆記",
          mtime: 1700000001,
          content_hash: "hash2",
        },
        {
          path: "0_Inbox/recent.md",
          title: "Recent Note",
          content: "Most recent note",
          mtime: 1700000999,
          content_hash: "hash3",
          sparkle_id: "bbbbbbbb-1111-4222-8333-444444444444",
        },
      ])
      .run();
  });

  describe("GET /api/vault (search)", () => {
    it("returns recent files when no query", async () => {
      const res = await app.request("/api/vault");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(3);
      // Should be ordered by mtime DESC
      expect(body.results[0].path).toBe("0_Inbox/recent.md");
    });

    it("searches by keyword via FTS5", async () => {
      const res = await app.request("/api/vault?q=Hello world");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results.length).toBeGreaterThanOrEqual(1);
      expect(body.results[0].path).toBe("notes/test.md");
    });

    it("searches Chinese content (trigram, 3+ chars)", async () => {
      const res = await app.request("/api/vault?q=中文筆記");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results.length).toBeGreaterThanOrEqual(1);
    });

    it("respects limit parameter", async () => {
      const res = await app.request("/api/vault?limit=1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(1);
    });

    it("escapes FTS5 special syntax (NOT, OR, quotes)", async () => {
      // These would fail with raw FTS5 syntax; with escaping they become literal searches
      for (const q of ["NOT test", 'hello "world"', "OR", "NEAR(a b)"]) {
        const res = await app.request(`/api/vault?q=${encodeURIComponent(q)}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.results).toBeDefined();
      }
    });

    it("returns 400 for query exceeding max length", async () => {
      const longQuery = "a".repeat(1001);
      const res = await app.request(`/api/vault?q=${longQuery}`);
      expect(res.status).toBe(400);
    });

    it("returns empty results for 1-2 char queries (trigram minimum)", async () => {
      const res = await app.request("/api/vault?q=ab");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(0);
    });

    it("includes sparkle_id in results", async () => {
      const res = await app.request("/api/vault");
      expect(res.status).toBe(200);
      const body = await res.json();
      const testNote = body.results.find((r: { path: string }) => r.path === "notes/test.md");
      expect(testNote.sparkle_id).toBe("aaaaaaaa-1111-4222-8333-444444444444");
    });

    it("filters by sparkle_id when filter=sparkle (no query)", async () => {
      const res = await app.request("/api/vault?filter=sparkle");
      expect(res.status).toBe(200);
      const body = await res.json();
      // Only 2 of 3 files have sparkle_id
      expect(body.results).toHaveLength(2);
      expect(body.results.every((r: { sparkle_id: string | null }) => r.sparkle_id !== null)).toBe(
        true,
      );
    });

    it("filters by sparkle_id when filter=sparkle (with query)", async () => {
      const res = await app.request("/api/vault?q=Hello world&filter=sparkle");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results.length).toBeGreaterThanOrEqual(1);
      expect(body.results[0].sparkle_id).toBe("aaaaaaaa-1111-4222-8333-444444444444");
    });

    it("returns all files when filter=all", async () => {
      const res = await app.request("/api/vault?filter=all");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.results).toHaveLength(3);
    });

    it("excludes non-sparkle results when filter=sparkle with query", async () => {
      const res = await app.request(
        `/api/vault?q=${encodeURIComponent("中文筆記")}&filter=sparkle`,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      // 中文筆記 has no sparkle_id, should be filtered out
      expect(body.results).toHaveLength(0);
    });
  });

  describe("GET /api/vault/by-sparkle-id/:id", () => {
    it("returns path for valid sparkle_id", async () => {
      const res = await app.request(
        "/api/vault/by-sparkle-id/aaaaaaaa-1111-4222-8333-444444444444",
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.path).toBe("notes/test.md");
    });

    it("returns 404 for unknown sparkle_id", async () => {
      const res = await app.request(
        "/api/vault/by-sparkle-id/cccccccc-1111-4222-8333-444444444444",
      );
      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid UUID format", async () => {
      const res = await app.request("/api/vault/by-sparkle-id/not-a-uuid");
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/vault/file/*path (read)", () => {
    it("returns file by path", async () => {
      const res = await app.request("/api/vault/file/notes/test.md");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.path).toBe("notes/test.md");
      expect(body.title).toBe("Test Note");
      expect(body.content).toBe("Hello world content");
      expect(body.mtime).toBe(1700000000);
    });

    it("returns 404 for nonexistent file", async () => {
      const res = await app.request("/api/vault/file/nonexistent.md");
      expect(res.status).toBe(404);
    });

    it("rejects path traversal with ../ (403 or 404, never 200)", async () => {
      const res = await app.request("/api/vault/file/../../etc/passwd");
      // URL normalization may resolve ../ before handler; both 403 and 404 are safe
      expect([403, 404]).toContain(res.status);
    });

    it("rejects path traversal with deeper nesting (403 or 404, never 200)", async () => {
      const res = await app.request("/api/vault/file/../../../etc/shadow");
      expect([403, 404]).toContain(res.status);
    });

    it("returns 400 for empty path", async () => {
      const res = await app.request("/api/vault/file/");
      // Empty path after stripping prefix
      expect([400, 404]).toContain(res.status);
    });
  });
});
