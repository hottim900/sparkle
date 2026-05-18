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
