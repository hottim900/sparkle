import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb } from "../../test-utils.js";
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

// Reset private sessions between tests
vi.mock("../../lib/private-session.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual };
});

import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth.js";
import { privateTokenMiddleware } from "../../middleware/private-token.js";
import { privateRouter } from "../private.js";
import { clearExpiredPrivateSessions } from "../../lib/private-session.js";

const TEST_TOKEN = "test-secret-token-12345";
const TEST_PIN = "123456";
const NEW_PIN = "654321";

function createApp() {
  const app = new Hono();
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => {
        return c.json({ error: "Request body too large (max 1MB)" }, 413);
      },
    }),
  );
  app.use("/api/*", authMiddleware);
  // Private token middleware on protected endpoints
  app.use("/api/private/pin", privateTokenMiddleware);
  app.use("/api/private/lock", privateTokenMiddleware);
  app.route("/api/private", privateRouter);
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

function jsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...authHeaders(),
    "Content-Type": "application/json",
    ...extra,
  };
}

beforeAll(() => {
  process.env.AUTH_TOKEN = TEST_TOKEN;
});

beforeEach(() => {
  const fresh = createTestDb();
  testDb = fresh.db;
  testSqlite = fresh.sqlite;
  app = createApp();
  // Clear all private sessions
  clearExpiredPrivateSessions(0);
});

describe("Private PIN management routes", () => {
  // ============================================================
  // GET /api/private/status
  // ============================================================
  describe("GET /api/private/status", () => {
    it("returns configured: false when no PIN is set", async () => {
      const res = await app.request("/api/private/status", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.configured).toBe(false);
    });

    it("returns configured: true after PIN is set up", async () => {
      // Setup PIN first
      await app.request("/api/private/setup", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: TEST_PIN }),
      });

      const res = await app.request("/api/private/status", {
        headers: authHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.configured).toBe(true);
    });

    it("returns 401 when no Authorization header", async () => {
      const res = await app.request("/api/private/status");
      expect(res.status).toBe(401);
    });
  });

  // ============================================================
  // POST /api/private/setup
  // ============================================================
  describe("POST /api/private/setup", () => {
    it("creates PIN and returns success", async () => {
      const res = await app.request("/api/private/setup", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: TEST_PIN }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it("returns 409 if PIN already exists", async () => {
      await app.request("/api/private/setup", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: TEST_PIN }),
      });

      const res = await app.request("/api/private/setup", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: NEW_PIN }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("returns 400 for invalid PIN format", async () => {
      const res = await app.request("/api/private/setup", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: "abc" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for too-short PIN", async () => {
      const res = await app.request("/api/private/setup", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: "123" }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ============================================================
  // POST /api/private/unlock
  // ============================================================
  describe("POST /api/private/unlock", () => {
    beforeEach(async () => {
      // Setup PIN before each unlock test
      await app.request("/api/private/setup", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: TEST_PIN }),
      });
    });

    it("returns token for correct PIN", async () => {
      const res = await app.request("/api/private/unlock", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: TEST_PIN }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBeTruthy();
      expect(typeof body.token).toBe("string");
    });

    it("returns 401 for wrong PIN", async () => {
      const res = await app.request("/api/private/unlock", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: "999999" }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("PIN 錯誤");
    });

    it("returns 404 if PIN not configured", async () => {
      // Create a fresh app with no PIN set up
      const fresh = createTestDb();
      testDb = fresh.db;
      testSqlite = fresh.sqlite;
      app = createApp();

      const res = await app.request("/api/private/unlock", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: TEST_PIN }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid PIN format", async () => {
      const res = await app.request("/api/private/unlock", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: "abc" }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ============================================================
  // POST /api/private/lock
  // ============================================================
  describe("POST /api/private/lock", () => {
    it("invalidates session token", async () => {
      // Setup PIN and unlock
      await app.request("/api/private/setup", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: TEST_PIN }),
      });
      const unlockRes = await app.request("/api/private/unlock", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: TEST_PIN }),
      });
      const { token } = await unlockRes.json();

      // Lock (requires private token)
      const lockRes = await app.request("/api/private/lock", {
        method: "POST",
        headers: jsonHeaders({ "X-Private-Token": token }),
      });
      expect(lockRes.status).toBe(200);
      const body = await lockRes.json();
      expect(body.success).toBe(true);
    });

    it("returns 401 without private token", async () => {
      const res = await app.request("/api/private/lock", {
        method: "POST",
        headers: jsonHeaders(),
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 with invalid private token", async () => {
      const res = await app.request("/api/private/lock", {
        method: "POST",
        headers: jsonHeaders({ "X-Private-Token": "invalid-token" }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ============================================================
  // PATCH /api/private/pin
  // ============================================================
  describe("PATCH /api/private/pin", () => {
    let sessionToken: string;

    beforeEach(async () => {
      // Setup PIN and unlock to get a session token
      await app.request("/api/private/setup", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: TEST_PIN }),
      });
      const unlockRes = await app.request("/api/private/unlock", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: TEST_PIN }),
      });
      const body = await unlockRes.json();
      sessionToken = body.token;
    });

    it("changes PIN successfully", async () => {
      const res = await app.request("/api/private/pin", {
        method: "PATCH",
        headers: jsonHeaders({ "X-Private-Token": sessionToken }),
        body: JSON.stringify({ old_pin: TEST_PIN, new_pin: NEW_PIN }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it("old PIN no longer works after change", async () => {
      // Change PIN
      await app.request("/api/private/pin", {
        method: "PATCH",
        headers: jsonHeaders({ "X-Private-Token": sessionToken }),
        body: JSON.stringify({ old_pin: TEST_PIN, new_pin: NEW_PIN }),
      });

      // Try unlocking with old PIN
      const res = await app.request("/api/private/unlock", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: TEST_PIN }),
      });
      expect(res.status).toBe(401);
    });

    it("new PIN works after change", async () => {
      // Change PIN
      await app.request("/api/private/pin", {
        method: "PATCH",
        headers: jsonHeaders({ "X-Private-Token": sessionToken }),
        body: JSON.stringify({ old_pin: TEST_PIN, new_pin: NEW_PIN }),
      });

      // Unlock with new PIN
      const res = await app.request("/api/private/unlock", {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ pin: NEW_PIN }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBeTruthy();
    });

    it("returns 401 for wrong old PIN", async () => {
      const res = await app.request("/api/private/pin", {
        method: "PATCH",
        headers: jsonHeaders({ "X-Private-Token": sessionToken }),
        body: JSON.stringify({ old_pin: "999999", new_pin: NEW_PIN }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 without private token", async () => {
      const res = await app.request("/api/private/pin", {
        method: "PATCH",
        headers: jsonHeaders(),
        body: JSON.stringify({ old_pin: TEST_PIN, new_pin: NEW_PIN }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 400 for invalid new PIN format", async () => {
      const res = await app.request("/api/private/pin", {
        method: "PATCH",
        headers: jsonHeaders({ "X-Private-Token": sessionToken }),
        body: JSON.stringify({ old_pin: TEST_PIN, new_pin: "abc" }),
      });
      expect(res.status).toBe(400);
    });
  });
});
