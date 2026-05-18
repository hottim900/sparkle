import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import type { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb, insertActiveRow, insertVaultRow } from "../../test-utils.js";

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
    debug: vi.fn(),
  },
}));

import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { wikilinksRouter } from "../wikilinks.js";

const TEST_TOKEN = "test-secret-token-12345-with-some-entropy";

function createApp() {
  const app = new Hono();
  app.use("/api/*", authMiddleware);
  app.route("/api/wikilinks", wikilinksRouter);
  return app;
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

function authedGet(path: string) {
  return app.request(path, {
    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
  });
}

function authedPost(path: string) {
  return app.request(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${TEST_TOKEN}` },
  });
}

describe("GET /api/wikilinks/resolve", () => {
  it("400 EMPTY_TITLE when title param is missing or blank", async () => {
    const res = await authedGet("/api/wikilinks/resolve?title=");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("EMPTY_TITLE");
  });

  it("404 NOT_FOUND when title resolves to nothing", async () => {
    const res = await authedGet("/api/wikilinks/resolve?title=NoSuchThing");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("NOT_FOUND");
  });

  it("404 NOT_FOUND when title collides (multiple active matches)", async () => {
    insertActiveRow(testSqlite, { title: "Dup" });
    insertActiveRow(testSqlite, { title: "Dup" });
    const res = await authedGet("/api/wikilinks/resolve?title=Dup");
    expect(res.status).toBe(404);
  });

  it("200 with id+origin+snippet for resolved active item", async () => {
    const id = insertActiveRow(testSqlite, {
      title: "MyTitle",
      content: "the quick brown fox",
    });
    const res = await authedGet("/api/wikilinks/resolve?title=MyTitle");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      title: string;
      origin: string;
      snippet: string;
    };
    expect(body).toMatchObject({ id, title: "MyTitle", origin: "active" });
    expect(body.snippet).toContain("quick brown");
  });

  it("200 with origin=vault for vault-only items", async () => {
    const id = insertVaultRow(testSqlite, {
      title: "VaultDoc",
      content_snippet: "exported note body",
    });
    const res = await authedGet("/api/wikilinks/resolve?title=VaultDoc");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; origin: string; snippet: string };
    expect(body.id).toBe(id);
    expect(body.origin).toBe("vault");
    expect(body.snippet).toContain("exported note body");
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/api/wikilinks/resolve?title=Foo");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/wikilinks/admin/rebuild", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/wikilinks/admin/rebuild", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("truncates reference_index and marks every active row dirty", async () => {
    const tgt = insertActiveRow(testSqlite, { title: "T" });
    const src = insertActiveRow(testSqlite, { content: "[[T]]" });
    testSqlite
      .prepare(
        `INSERT INTO reference_index (source_id, target_id, char_offset, raw_title)
         VALUES (?, ?, 0, 'T')`,
      )
      .run(src, tgt);

    const res = await authedPost("/api/wikilinks/admin/rebuild");
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string; queued: number };
    expect(body.status).toBe("queued");
    expect(body.queued).toBe(2);

    const refs = testSqlite.prepare("SELECT COUNT(*) AS n FROM reference_index").get() as {
      n: number;
    };
    expect(refs.n).toBe(0);
    const dirty = testSqlite
      .prepare("SELECT COUNT(*) AS n FROM items_active WHERE reindex_dirty = 1")
      .get() as { n: number };
    expect(dirty.n).toBe(2);
  });
});

describe("GET /api/wikilinks/admin/recent-renames", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/wikilinks/admin/recent-renames");
    expect(res.status).toBe(401);
  });

  it("returns recent rename rows in descending performed_at order", async () => {
    testSqlite
      .prepare(
        `INSERT INTO rename_history (id, target_id, old_title, new_title, source_count, performed_at, performed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("h1", "t1", "Old1", "New1", 3, "2026-05-18T01:00:00Z", "user");
    testSqlite
      .prepare(
        `INSERT INTO rename_history (id, target_id, old_title, new_title, source_count, performed_at, performed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("h2", "t2", "Old2", "New2", 5, "2026-05-18T02:00:00Z", "user");

    const res = await authedGet("/api/wikilinks/admin/recent-renames");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      renames: { id: string; old_title: string; new_title: string }[];
    };
    expect(body.renames).toHaveLength(2);
    expect(body.renames[0]!.id).toBe("h2"); // most recent first
    expect(body.renames[1]!.id).toBe("h1");
  });
});

describe("POST /api/wikilinks/admin/undo-rename/:historyId", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/wikilinks/admin/undo-rename/foo", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 404 when historyId is unknown", async () => {
    const res = await authedPost("/api/wikilinks/admin/undo-rename/nonexistent");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("RENAME_NOT_FOUND");
  });

  it("undoes a recorded rename and returns rewritten count", async () => {
    // Seed: target was renamed Original → Renamed, source still cites Renamed.
    const tgt = insertActiveRow(testSqlite, { title: "Renamed" });
    const src = insertActiveRow(testSqlite, { content: "see [[Renamed]] now" });
    testSqlite
      .prepare(
        `INSERT INTO reference_index (source_id, target_id, char_offset, raw_title)
         VALUES (?, ?, 4, 'Renamed')`,
      )
      .run(src, tgt);
    testSqlite
      .prepare(
        `INSERT INTO rename_history (id, target_id, old_title, new_title, source_count, performed_at, performed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("hist1", tgt, "Original", "Renamed", 1, "2026-05-18T01:00:00Z", "user");

    const res = await authedPost("/api/wikilinks/admin/undo-rename/hist1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; rewrittenCount: number };
    expect(body.status).toBe("undone");
    expect(body.rewrittenCount).toBe(1);

    const newContent = testSqlite
      .prepare("SELECT content FROM items_active WHERE id = ?")
      .get(src) as { content: string };
    expect(newContent.content).toBe("see [[Original]] now");

    const tgtTitle = testSqlite.prepare("SELECT title FROM items_active WHERE id = ?").get(tgt) as {
      title: string;
    };
    expect(tgtTitle.title).toBe("Original");
  });
});
