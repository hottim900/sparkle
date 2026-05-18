import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb, insertActiveRow } from "../../test-utils.js";
import { bodyLimit } from "hono/body-limit";

/**
 * Pre-PR0b: PATCH /api/items/:id maps RevisionMismatchError to HTTP 412
 * with a structured payload that lets the client merge (or the rename
 * engine reconcile) without an extra round-trip.
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
import { computeRevision } from "../../lib/revision.js";

const TEST_TOKEN = "test-secret-token-12345";
const NOW = new Date().toISOString();
const ITEM_ID = "44444444-4444-4444-8444-444444444444";

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

function seedItem(content: string) {
  insertActiveRow(testSqlite, {
    id: ITEM_ID,
    title: "T",
    content,
    created: NOW,
    modified: NOW,
  });
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

describe("PATCH /api/items/:id revision compare-and-swap", () => {
  it("succeeds (200) when revision matches", async () => {
    seedItem("hello");
    const res = await app.request(`/api/items/${ITEM_ID}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ content: "hello world", revision: computeRevision("hello") }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: string };
    expect(body.content).toBe("hello world");
  });

  it("returns 412 with structured payload when revision is stale", async () => {
    seedItem("v1");
    const staleRev = computeRevision("v0");
    const res = await app.request(`/api/items/${ITEM_ID}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ content: "v2-from-me", revision: staleRev }),
    });
    expect(res.status).toBe(412);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("REVISION_MISMATCH");
    expect(body.expected_revision).toBe(staleRev);
    expect(body.current_revision).toBe(computeRevision("v1"));
    expect(body.current_content).toBe("v1");
    expect(typeof body.error).toBe("string");
    expect(typeof body.error_en).toBe("string");
  });

  it("succeeds (200) when revision is omitted (backwards compatible)", async () => {
    seedItem("anything");
    const res = await app.request(`/api/items/${ITEM_ID}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ content: "no revision supplied" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects (400) a malformed revision token", async () => {
    seedItem("body");
    const res = await app.request(`/api/items/${ITEM_ID}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ content: "x", revision: "too-short" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 412 even on title-only update when revision is stale", async () => {
    seedItem("body");
    const staleRev = computeRevision("other");
    const res = await app.request(`/api/items/${ITEM_ID}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "Renamed", revision: staleRev }),
    });
    expect(res.status).toBe(412);
  });
});
