import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb, insertActiveRow, insertVaultRow } from "../../test-utils.js";
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
import { itemsRouter } from "../items.js";

const TEST_TOKEN = "test-secret-token-12345";
const NOW = new Date().toISOString();

const VAULT_ID = "55555555-5555-4555-8555-555555555555";
const ACTIVE_ID = "66666666-6666-4666-8666-666666666666";
const VAULT_EXPORT_PATH = "Notes/released-me.md";

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
  app.onError((_err, c) => c.json({ error: "Internal server error" }, 500));
  return app;
}

let app: Hono;

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
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

describe("DELETE /api/items/:id/vault-stub", () => {
  it("hard-deletes the vault row and nulls vault_files.sparkle_id", async () => {
    insertVaultRow(testSqlite, {
      id: VAULT_ID,
      title: "Released Note",
      exported_at: NOW,
      created: NOW,
      content_snippet: "snippet",
    });
    // Seed a vault_files row linked to this sparkle_id — that's the sole
    // source for vault_path now.
    testSqlite
      .prepare(
        `INSERT INTO vault_files (path, title, frontmatter, content, mtime, content_hash, sparkle_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(VAULT_EXPORT_PATH, "Released Note", null, "body", Date.now(), "hash-123", VAULT_ID);

    const res = await app.request(`/api/items/${VAULT_ID}/vault-stub`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe(VAULT_ID);
    expect(body.vault_path).toBe(VAULT_EXPORT_PATH);

    // items_vault row gone
    const vaultRow = testSqlite.prepare("SELECT id FROM items_vault WHERE id = ?").get(VAULT_ID);
    expect(vaultRow).toBeUndefined();

    // vault_files row preserved, sparkle_id nulled
    const vaultFile = testSqlite
      .prepare("SELECT sparkle_id FROM vault_files WHERE path = ?")
      .get(VAULT_EXPORT_PATH) as { sparkle_id: string | null };
    expect(vaultFile).toBeTruthy();
    expect(vaultFile.sparkle_id).toBeNull();
  });

  it("returns 404 when the id belongs to items_active (not a vault stub)", async () => {
    insertActiveRow(testSqlite, {
      id: ACTIVE_ID,
      title: "Active Note",
      content: "x",
      status: "permanent",
      created: NOW,
      modified: NOW,
    });
    const res = await app.request(`/api/items/${ACTIVE_ID}/vault-stub`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("NOT_VAULT_ITEM");
    // Active row preserved
    const row = testSqlite.prepare("SELECT id FROM items_active WHERE id = ?").get(ACTIVE_ID);
    expect(row).toBeTruthy();
  });

  it("returns 409 ALREADY_RELEASED when the id does not exist in either table", async () => {
    const res = await app.request(`/api/items/99999999-9999-4999-8999-999999999999/vault-stub`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("ALREADY_RELEASED");
  });

  it("leaves vault .md untouched when vault_files row is absent", async () => {
    insertVaultRow(testSqlite, {
      id: VAULT_ID,
      exported_at: NOW,
      created: NOW,
    });
    // No vault_files row seeded.
    const res = await app.request(`/api/items/${VAULT_ID}/vault-stub`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    // items_vault deleted
    expect(
      testSqlite.prepare("SELECT id FROM items_vault WHERE id = ?").get(VAULT_ID),
    ).toBeUndefined();
  });

  it("release endpoint does not cascade into todos.linked_note_id (D2 dangling policy)", async () => {
    // Seed a todo whose linked_note_id points at a vault row (cross-table —
    // FK would normally reject this, so we bypass the FK check for seeding).
    // This mirrors the migration-era cleanup exception (D12) where a few
    // legacy rows slipped through pointing at vault ids. The release endpoint
    // MUST leave such dangling refs untouched so the UI can render the
    // `linked_note_origin: 'missing'` state.
    insertVaultRow(testSqlite, {
      id: VAULT_ID,
      exported_at: NOW,
      created: NOW,
    });
    const TODO_ID = "77777777-7777-4777-8777-777777777777";
    testSqlite.pragma("foreign_keys = OFF");
    insertActiveRow(testSqlite, {
      id: TODO_ID,
      type: "todo",
      status: "active",
      title: "linked todo",
      linked_note_id: VAULT_ID,
      created: NOW,
      modified: NOW,
    });
    testSqlite.pragma("foreign_keys = ON");

    const res = await app.request(`/api/items/${VAULT_ID}/vault-stub`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);

    const todoRow = testSqlite
      .prepare("SELECT linked_note_id FROM items_active WHERE id = ?")
      .get(TODO_ID) as { linked_note_id: string | null };
    expect(todoRow.linked_note_id).toBe(VAULT_ID);
  });
});
