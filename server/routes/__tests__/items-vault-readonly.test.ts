import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb, insertActiveRow, insertVaultRow } from "../../test-utils.js";
import { bodyLimit } from "hono/body-limit";

// --- In-memory DB setup & module mock ---

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
import { privateTokenMiddleware } from "../../middleware/private-token.js";
import { itemsRouter } from "../items.js";
import { sharesRouter } from "../shares.js";
import { privateRouter } from "../private.js";
import { clearExpiredPrivateSessions } from "../../lib/private-session.js";
import { hashPin } from "../../lib/pin.js";
import { VAULT_READONLY } from "../../lib/vault-errors.js";

const TEST_TOKEN = "test-secret-token-12345";
const TEST_PIN = "123456";
const NOW = new Date().toISOString();

// Valid UUID v4 literals (version nibble 4, variant nibble 8/9/a/b)
const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const VAULT_ID_PRIVATE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTIVE_ID = "22222222-2222-4222-8222-222222222222";
const VAULT_EXPORT_PATH = "Notes/exported-note.md";
const VAULT_CONTENT_FULL = "vault content ".repeat(40);
const VAULT_SNIPPET = VAULT_CONTENT_FULL.slice(0, 500);

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
  // Private routes need the token middleware; other /api/* routes only need auth.
  app.use("/api/private/items", privateTokenMiddleware);
  app.use("/api/private/items/*", privateTokenMiddleware);
  app.use("/api/private/search", privateTokenMiddleware);
  app.use("/api/private/tags", privateTokenMiddleware);
  app.use("/api/private/pin", privateTokenMiddleware);
  app.use("/api/private/lock", privateTokenMiddleware);
  app.route("/api/private", privateRouter);
  app.route("/api/items", itemsRouter);
  app.route("/api", sharesRouter);
  app.onError((err, c) => {
    console.error("Unhandled error:", err);
    return c.json({ error: "Internal server error" }, 500);
  });
  return app;
}

let app: Hono;
let sessionToken: string;

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

function jsonHeaders(): Record<string, string> {
  return { ...authHeaders(), "Content-Type": "application/json" };
}

function privateHeaders(): Record<string, string> {
  return { ...jsonHeaders(), "X-Private-Token": sessionToken };
}

/**
 * Pre-computed once in beforeAll to avoid per-test scrypt cost (~100ms each).
 * beforeEach seeds it into the fresh settings table directly, so the test only
 * pays for the `/unlock` verifyPin — not setup's hashPin as well.
 */
let cachedPinHash: string;

async function unlockWithSeededPin(testApp: Hono): Promise<string> {
  testSqlite
    .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
    .run("private_pin_hash", cachedPinHash);
  const unlockRes = await testApp.request("/api/private/unlock", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ pin: TEST_PIN }),
  });
  const body = (await unlockRes.json()) as { token: string };
  return body.token;
}

// File-scoped defaults wrap the shared helpers so each test's call site stays
// terse ({} for the happy-path vault/active item used by most tests).
const insertVaultItem = (overrides: Parameters<typeof insertVaultRow>[1] = {}): string =>
  insertVaultRow(testSqlite, {
    id: VAULT_ID,
    title: "Exported Note",
    export_path: VAULT_EXPORT_PATH,
    exported_at: NOW,
    created: NOW,
    content_snippet: VAULT_SNIPPET,
    ...overrides,
  });

const insertActiveItem = (overrides: Parameters<typeof insertActiveRow>[1] = {}): string =>
  insertActiveRow(testSqlite, {
    id: ACTIVE_ID,
    title: "Active Note",
    content: "active content",
    status: "permanent",
    created: NOW,
    modified: NOW,
    ...overrides,
  });

/**
 * Assert every field of the standard VAULT_READONLY payload. Callers that
 * verify a custom `error` (like the re-export message) should check `error`
 * separately and pass `{ skipError: true }`.
 */
function expectFullReadonlyPayload(
  body: Record<string, unknown>,
  opts: { vaultPath?: string | null; skipError?: boolean } = {},
) {
  const vaultPath = opts.vaultPath === undefined ? VAULT_EXPORT_PATH : opts.vaultPath;
  expect(body.code).toBe(VAULT_READONLY);
  expect(body.vault_path).toBe(vaultPath);
  expect(body.hint_endpoint).toBe("DELETE /api/items/:id/vault-stub");
  expect(body.hint_tool_by_id).toBe("sparkle_write_obsidian");
  expect(body.hint_tool_by_path).toBe("sparkle_write_obsidian_by_path");
  expect(body.doc_url).toBe("sparkle://docs/data-model#vault-items");
  expect(typeof body.error_en).toBe("string");
  expect((body.error_en as string).length).toBeGreaterThan(0);
  if (!opts.skipError) {
    expect(typeof body.error).toBe("string");
    expect((body.error as string).length).toBeGreaterThan(0);
  }
}

beforeAll(async () => {
  process.env.AUTH_TOKEN = TEST_TOKEN;
  cachedPinHash = await hashPin(TEST_PIN);
});

beforeEach(async () => {
  const fresh = createTestDb();
  testDb = fresh.db;
  testSqlite = fresh.sqlite;
  app = createApp();
  clearExpiredPrivateSessions(0);
  sessionToken = await unlockWithSeededPin(app);
});

// ============================================================
// GET /api/items/:id — vault read-through
// ============================================================

describe("GET /api/items/:id — vault-origin read-through", () => {
  it("returns 200 with origin='vault' + vault-only fields populated", async () => {
    insertVaultItem();
    const res = await app.request(`/api/items/${VAULT_ID}`, {
      method: "GET",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(VAULT_ID);
    expect(body.origin).toBe("vault");
    expect(body.export_path).toBe(VAULT_EXPORT_PATH);
    expect(body.content_snippet).toBe(VAULT_SNIPPET);
    // Synthesized / compat fields on vault rows (see item-enrichment.ts vaultBase)
    expect(body.status).toBe("exported");
    expect(body.content).toBe(VAULT_SNIPPET); // content mirrors snippet for UI compat
    expect(body.modified).toBe(NOW); // mirrors exported_at
    // Active-only fields explicitly null on vault rows
    expect(body.viewed_at).toBeNull();
    expect(body.priority).toBeNull();
    expect(body.due).toBeNull();
    expect(body.linked_note_id).toBeNull();
    expect(body.paused_at).toBeNull();
    expect(body.paused_context).toBeNull();
    // paused is 0 (not null) so UI boolean checks work without branching
    expect(body.paused).toBe(0);
  });

  it("returns 200 with origin='active' for active items (control)", async () => {
    insertActiveItem();
    const res = await app.request(`/api/items/${ACTIVE_ID}`, {
      method: "GET",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.origin).toBe("active");
    expect(body.content_snippet).toBeNull();
    expect(body.export_path).toBeNull();
  });

  it("returns 200 when vault row has null export_path (vault_path=null in response)", async () => {
    insertVaultItem({ export_path: null });
    const res = await app.request(`/api/items/${VAULT_ID}`, {
      method: "GET",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.origin).toBe("vault");
    expect(body.export_path).toBeNull();
  });
});

// ============================================================
// PATCH /api/items/:id — vault origin 409
// ============================================================

describe("PATCH /api/items/:id — vault-origin 409 VAULT_READONLY", () => {
  it("returns 409 + full payload when patching a vault item", async () => {
    insertVaultItem();
    const res = await app.request(`/api/items/${VAULT_ID}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "attempt to update" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expectFullReadonlyPayload(body);
    // Vault row title is unchanged
    const row = testSqlite.prepare("SELECT title FROM items_vault WHERE id = ?").get(VAULT_ID) as {
      title: string;
    };
    expect(row.title).toBe("Exported Note");
  });

  it("returns 409 with vault_path=null when export_path is null", async () => {
    insertVaultItem({ export_path: null });
    const res = await app.request(`/api/items/${VAULT_ID}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expectFullReadonlyPayload(body, { vaultPath: null });
  });
});

// ============================================================
// DELETE /api/items/:id — vault origin 409
// ============================================================

describe("DELETE /api/items/:id — vault-origin 409 VAULT_READONLY", () => {
  it("returns 409 + full payload and keeps the vault row intact", async () => {
    insertVaultItem();
    const res = await app.request(`/api/items/${VAULT_ID}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expectFullReadonlyPayload(body);
    // Vault row still present
    const row = testSqlite.prepare("SELECT id FROM items_vault WHERE id = ?").get(VAULT_ID);
    expect(row).toBeTruthy();
  });
});

// ============================================================
// POST /api/items/:id/export — already-exported guard
// ============================================================

describe("POST /api/items/:id/export — vault-origin 409 (re-export blocked)", () => {
  it("returns 409 with VAULT_READONLY shape + custom error copy on re-export attempt", async () => {
    insertVaultItem();
    const res = await app.request(`/api/items/${VAULT_ID}/export`, {
      method: "POST",
      headers: authHeaders(),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    // Standard shape (minus error which is overridden)
    expectFullReadonlyPayload(body, { skipError: true });
    expect(body.error).toBe("已匯出的項目無法再次匯出");
  });
});

// ============================================================
// POST /api/items/batch — vault IDs silently skipped
// ============================================================

describe("POST /api/items/batch — vault IDs skipped (WHERE clause scoped to items_active)", () => {
  it("delete: mixes active+vault IDs, affects only active, skipped count reflects vault IDs", async () => {
    insertVaultItem();
    insertActiveItem();
    const res = await app.request("/api/items/batch", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ action: "delete", ids: [VAULT_ID, ACTIVE_ID] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(1);
    expect(body.skipped).toBe(1);
    // Vault row preserved, active row gone
    expect(
      testSqlite.prepare("SELECT id FROM items_vault WHERE id = ?").get(VAULT_ID),
    ).toBeTruthy();
    expect(
      testSqlite.prepare("SELECT id FROM items_active WHERE id = ?").get(ACTIVE_ID),
    ).toBeFalsy();
  });

  it("archive: vault IDs are skipped, active row is archived", async () => {
    insertVaultItem();
    insertActiveItem({ status: "developing" });
    const res = await app.request("/api/items/batch", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ action: "archive", ids: [VAULT_ID, ACTIVE_ID] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.affected).toBe(1);
    expect(body.skipped).toBe(1);
    const activeRow = testSqlite
      .prepare("SELECT status FROM items_active WHERE id = ?")
      .get(ACTIVE_ID) as { status: string };
    expect(activeRow.status).toBe("archived");
  });
});

// ============================================================
// POST /api/items/:id/share — vault rows cannot be shared
// ============================================================

describe("POST /api/items/:id/share — vault-origin returns 404 (share_tokens FK → items_active)", () => {
  it("returns 404 when trying to create a share token on a vault item", async () => {
    insertVaultItem();
    const res = await app.request(`/api/items/${VAULT_ID}/share`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ visibility: "unlisted" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Item not found");
    // No share_token row created
    const tokens = testSqlite
      .prepare("SELECT COUNT(*) AS n FROM share_tokens WHERE item_id = ?")
      .get(VAULT_ID) as { n: number };
    expect(tokens.n).toBe(0);
  });
});

// ============================================================
// GET /api/items/:id/linked-todos — vault id is a valid lookup target
// ============================================================

describe("GET /api/items/:id/linked-todos — vault lookup does not 404", () => {
  it("returns 200 with empty items[] (FK cascade-null prevents todos pointing at vault)", async () => {
    insertVaultItem();
    const res = await app.request(`/api/items/${VAULT_ID}/linked-todos`, {
      method: "GET",
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });
});

// ============================================================
// Private routes — vault origin guards
// ============================================================

describe("PATCH /api/private/items/:id — vault-origin 409 VAULT_READONLY", () => {
  it("returns 409 + full payload when patching a private vault item", async () => {
    insertVaultItem({ id: VAULT_ID_PRIVATE, is_private: 1 });
    const res = await app.request(`/api/private/items/${VAULT_ID_PRIVATE}`, {
      method: "PATCH",
      headers: privateHeaders(),
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expectFullReadonlyPayload(body);
  });
});

describe("DELETE /api/private/items/:id — vault-origin 409 VAULT_READONLY", () => {
  it("returns 409 and keeps vault row intact (was: silent 204 pre-fix)", async () => {
    insertVaultItem({ id: VAULT_ID_PRIVATE, is_private: 1 });
    const res = await app.request(`/api/private/items/${VAULT_ID_PRIVATE}`, {
      method: "DELETE",
      headers: privateHeaders(),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expectFullReadonlyPayload(body);
    // Vault row was NOT deleted
    expect(
      testSqlite.prepare("SELECT id FROM items_vault WHERE id = ?").get(VAULT_ID_PRIVATE),
    ).toBeTruthy();
  });
});
