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

describe("PATCH /api/items/:id swept_references contract (DX-5)", () => {
  it("includes swept_references in response when title change triggers rename engine", async () => {
    const target = insertActiveRow(testSqlite, { title: "Hub" });
    const source = insertActiveRow(testSqlite, { content: "see [[Hub]]" });
    // Manual reference_index entry so the rename engine finds the source
    // without waiting for the background worker (60s interval).
    testSqlite
      .prepare(
        `INSERT INTO reference_index (source_id, target_id, char_offset, raw_title, kind)
         VALUES (?, ?, 4, 'Hub', 'wikilink')`,
      )
      .run(source, target);

    const res = await app.request(`/api/items/${target}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "Renamed" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      title: string;
      swept_references?: {
        rewritten_count: number;
        rewritten_source_ids: string[];
        rewritten_sources: Array<{ id: string; title: string }>;
        skipped_share_token_source_ids: string[];
        history_id: string | null;
      };
    };
    expect(body.title).toBe("Renamed");
    expect(body.swept_references).toBeDefined();
    expect(body.swept_references!.rewritten_count).toBe(1);
    expect(body.swept_references!.rewritten_source_ids).toEqual([source]);
    expect(body.swept_references!.skipped_share_token_source_ids).toEqual([]);
    expect(body.swept_references!.history_id).toBeTruthy();
  });

  it("DES-5: includes id+title pairs in rewritten_sources for the rename dialog", async () => {
    const target = insertActiveRow(testSqlite, { title: "Hub" });
    const sourceA = insertActiveRow(testSqlite, {
      title: "First Source",
      content: "see [[Hub]]",
    });
    const sourceB = insertActiveRow(testSqlite, {
      title: "Second Source",
      content: "[[Hub]] also",
    });
    testSqlite
      .prepare(
        `INSERT INTO reference_index (source_id, target_id, char_offset, raw_title, kind)
         VALUES (?, ?, 4, 'Hub', 'wikilink'),
                (?, ?, 0, 'Hub', 'wikilink')`,
      )
      .run(sourceA, target, sourceB, target);

    const res = await app.request(`/api/items/${target}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "Centre" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      swept_references?: {
        rewritten_count: number;
        rewritten_sources: Array<{ id: string; title: string }>;
      };
    };
    expect(body.swept_references!.rewritten_count).toBe(2);
    expect(body.swept_references!.rewritten_sources).toHaveLength(2);
    // Titles are captured pre-rename per source row, frontend renders inline.
    const byId = Object.fromEntries(
      body.swept_references!.rewritten_sources.map((s) => [s.id, s.title]),
    );
    expect(byId[sourceA]).toBe("First Source");
    expect(byId[sourceB]).toBe("Second Source");
  });

  it("OMITS swept_references when title didn't change (no rename)", async () => {
    const id = insertActiveRow(testSqlite, { title: "Static", content: "body" });

    const res = await app.request(`/api/items/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ content: "new body" }), // no title change
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { swept_references?: unknown };
    expect(body.swept_references).toBeUndefined();
  });

  it("OMITS swept_references when first-time title set (empty → non-empty is not a rename)", async () => {
    testSqlite
      .prepare(
        `INSERT INTO items_active (id, type, status, title, content, created, modified)
         VALUES ('empty-1', 'note', 'fleeting', '', '', '2026-01-01', '2026-01-01')`,
      )
      .run();

    const res = await app.request(`/api/items/empty-1`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "Now Named" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { swept_references?: unknown };
    expect(body.swept_references).toBeUndefined();
  });

  it("DX-2: rejects rename PATCH with 409 RENAME_STATE_CHANGED when expected_state_hash is stale", async () => {
    const target = insertActiveRow(testSqlite, { title: "Hub", content: "" });
    const source = insertActiveRow(testSqlite, { content: "see [[Hub]] here" });
    testSqlite
      .prepare(
        `INSERT INTO reference_index (source_id, target_id, char_offset, raw_title, kind)
         VALUES (?, ?, 4, 'Hub', 'wikilink')`,
      )
      .run(source, target);

    // Caller pretends to have a hash from a prior preview, but it's bogus.
    const staleHash = "0".repeat(64);
    const res = await app.request(`/api/items/${target}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "Renamed", expected_state_hash: staleHash }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      code: string;
      expected_state_hash: string;
      actual_state_hash: string;
    };
    expect(body.code).toBe("RENAME_STATE_CHANGED");
    expect(body.expected_state_hash).toBe(staleHash);
    expect(body.actual_state_hash).toMatch(/^[a-f0-9]{64}$/);
    // No rewrite happened.
    const src = testSqlite.prepare("SELECT content FROM items_active WHERE id = ?").get(source) as {
      content: string;
    };
    expect(src.content).toBe("see [[Hub]] here");
  });
});
