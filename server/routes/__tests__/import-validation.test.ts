import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb } from "../../test-utils.js";

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
  },
}));

import { Hono } from "hono";
import { itemsActive } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { importSchema } from "../../schemas/items.js";
import { logger } from "../../lib/logger.js";

const TEST_TOKEN = "test-secret-token-12345";

function authHeaders() {
  return { Authorization: `Bearer ${TEST_TOKEN}` };
}

function jsonHeaders() {
  return {
    ...authHeaders(),
    "Content-Type": "application/json",
  };
}

function createApp() {
  const app = new Hono();

  // Simple auth middleware for tests
  app.use("*", async (c, next) => {
    const auth = c.req.header("Authorization");
    if (!auth || auth !== `Bearer ${TEST_TOKEN}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });

  const OLD_FIELD_NAMES = ["due_date", "created_at", "updated_at"];

  app.post("/api/import", async (c) => {
    try {
      const body = await c.req.json();

      if (body.items && Array.isArray(body.items) && body.items.length > 0) {
        const sample = body.items[0];
        for (const oldField of OLD_FIELD_NAMES) {
          if (oldField in sample) {
            return c.json(
              { error: "Unrecognized field names — please re-export from current version" },
              400,
            );
          }
        }
        if (sample.status === "inbox") {
          return c.json(
            { error: "Unrecognized field names — please re-export from current version" },
            400,
          );
        }
      }

      const { items: importItems } = importSchema.parse(body);

      let imported = 0;
      let updated = 0;
      let skipped = 0;
      const warnings: string[] = [];

      const importingIds = new Set(importItems.map((item) => item.id));

      const txResult = testSqlite.transaction(() => {
        for (const item of importItems) {
          if (item.linked_note_id) {
            const linkedExists =
              importingIds.has(item.linked_note_id) ||
              testDb
                .select()
                .from(itemsActive)
                .where(eq(itemsActive.id, item.linked_note_id))
                .get();
            if (!linkedExists) {
              logger.warn(
                { itemId: item.id, linked_note_id: item.linked_note_id },
                "Import: linked_note_id references non-existent item, skipping",
              );
              warnings.push(
                `Item ${item.id}: linked_note_id "${item.linked_note_id}" not found, skipped`,
              );
              skipped++;
              continue;
            }
          }

          if (item.category_id) {
            const categoryExists = testSqlite
              .prepare("SELECT id FROM categories WHERE id = ?")
              .get(item.category_id);
            if (!categoryExists) {
              logger.warn(
                { itemId: item.id, category_id: item.category_id },
                "Import: category_id references non-existent category, skipping",
              );
              warnings.push(
                `Item ${item.id}: category_id "${item.category_id}" not found, skipped`,
              );
              skipped++;
              continue;
            }
          }

          const existing = testDb
            .select()
            .from(itemsActive)
            .where(eq(itemsActive.id, item.id))
            .get();

          if (existing) {
            if (existing.is_private) {
              skipped++;
              continue;
            }
            testDb
              .update(itemsActive)
              .set({
                type: item.type,
                title: item.title,
                content: item.content,
                status: item.status,
                priority: item.priority,
                due: item.due,
                tags: JSON.stringify(item.tags),
                origin: item.origin,
                source: item.source,
                aliases: JSON.stringify(item.aliases),
                linked_note_id: item.linked_note_id,
                category_id: item.category_id,
                created: item.created,
                modified: item.modified,
              })
              .where(eq(itemsActive.id, item.id))
              .run();
            updated++;
          } else {
            testDb
              .insert(itemsActive)
              .values({
                ...item,
                tags: JSON.stringify(item.tags),
                aliases: JSON.stringify(item.aliases),
                is_private: 0,
              })
              .run();
            imported++;
          }
        }
        return { imported, updated, skipped };
      })();

      return c.json({ ...txResult, warnings: warnings.length > 0 ? warnings : undefined });
    } catch (e) {
      if (e instanceof ZodError) {
        return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
      }
      throw e;
    }
  });

  app.onError((_err, c) => {
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  const created = createTestDb();
  testSqlite = created.sqlite;
  testDb = created.db;
  vi.mocked(logger.warn).mockReset();
  app = createApp();
});

// ============================================================
// Import schema consistency (#188) — tags max length
// ============================================================
describe("POST /api/import — tags max length consistency", () => {
  it("rejects import with tag exceeding 50 chars (consistent with create/update)", async () => {
    const now = new Date().toISOString();
    const longTag = "a".repeat(51);
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440010",
            title: "Long tag item",
            type: "note",
            status: "fleeting",
            content: "",
            priority: null,
            due: null,
            tags: JSON.stringify([longTag]),
            origin: "",
            source: null,
            aliases: "[]",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts import with tag exactly 50 chars", async () => {
    const now = new Date().toISOString();
    const tag50 = "a".repeat(50);
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440011",
            title: "Max tag item",
            type: "note",
            status: "fleeting",
            content: "",
            priority: null,
            due: null,
            tags: JSON.stringify([tag50]),
            origin: "",
            source: null,
            aliases: "[]",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================
// Import schema — linked_note_id UUID validation
// ============================================================
describe("POST /api/import — linked_note_id UUID validation", () => {
  it("rejects import with non-UUID linked_note_id", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440020",
            title: "Bad linked_note_id",
            type: "note",
            status: "fleeting",
            content: "",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            linked_note_id: "not-a-uuid",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts import with null linked_note_id", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440021",
            title: "Null linked_note_id",
            type: "note",
            status: "fleeting",
            content: "",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            linked_note_id: null,
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================
// Import schema — due date YYYY-MM-DD validation
// ============================================================
describe("POST /api/import — due date format validation", () => {
  it("rejects import with invalid due date format", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440030",
            title: "Bad due date",
            type: "todo",
            status: "active",
            content: "",
            priority: null,
            due: "2026/03/27",
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects import with ISO datetime string as due date", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440031",
            title: "ISO due date",
            type: "todo",
            status: "active",
            content: "",
            priority: null,
            due: "2026-03-27T10:00:00Z",
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts import with valid YYYY-MM-DD due date", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440032",
            title: "Valid due date",
            type: "todo",
            status: "active",
            content: "",
            priority: null,
            due: "2026-03-27",
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
  });

  it("accepts import with null due date", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440033",
            title: "Null due date",
            type: "note",
            status: "fleeting",
            content: "",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================
// Import — FK existence checks (#184)
// ============================================================
describe("POST /api/import — FK existence checks", () => {
  it("skips item with non-existent linked_note_id and returns warning", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440040",
            title: "Dangling linked_note_id",
            type: "todo",
            status: "active",
            content: "",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            linked_note_id: "550e8400-e29b-41d4-a716-446655440099",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe(1);
    expect(body.imported).toBe(0);
    expect(body.warnings).toBeDefined();
    expect(body.warnings[0]).toContain("linked_note_id");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("skips item with non-existent category_id and returns warning", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440041",
            title: "Dangling category_id",
            type: "note",
            status: "fleeting",
            content: "",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            category_id: "550e8400-e29b-41d4-a716-446655440099",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe(1);
    expect(body.imported).toBe(0);
    expect(body.warnings).toBeDefined();
    expect(body.warnings[0]).toContain("category_id");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("accepts item when linked_note_id exists in DB", async () => {
    const now = new Date().toISOString();
    // First create the target item
    testDb
      .insert(itemsActive)
      .values({
        id: "550e8400-e29b-41d4-a716-446655440050",
        title: "Target note",
        type: "note",
        status: "fleeting",
        content: "",
        tags: "[]",
        aliases: "[]",
        origin: "",
        created: now,
        modified: now,
      })
      .run();

    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440051",
            title: "Linked item",
            type: "todo",
            status: "active",
            content: "",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            linked_note_id: "550e8400-e29b-41d4-a716-446655440050",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.warnings).toBeUndefined();
  });

  it("accepts item when linked_note_id references another item in same import batch", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440060",
            title: "Note A",
            type: "note",
            status: "fleeting",
            content: "",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            created: now,
            modified: now,
          },
          {
            id: "550e8400-e29b-41d4-a716-446655440061",
            title: "Todo linked to Note A",
            type: "todo",
            status: "active",
            content: "",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            linked_note_id: "550e8400-e29b-41d4-a716-446655440060",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(2);
    expect(body.skipped).toBe(0);
    expect(body.warnings).toBeUndefined();
  });

  it("accepts item when category_id exists in DB", async () => {
    const now = new Date().toISOString();
    // Create a category first
    testSqlite
      .prepare(
        "INSERT INTO categories (id, name, sort_order, created, modified) VALUES (?, ?, ?, ?, ?)",
      )
      .run("550e8400-e29b-41d4-a716-446655440070", "Test Category", 0, now, now);

    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440071",
            title: "Categorized item",
            type: "note",
            status: "fleeting",
            content: "",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            category_id: "550e8400-e29b-41d4-a716-446655440070",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.skipped).toBe(0);
    expect(body.warnings).toBeUndefined();
  });

  it("reports mixed results: some imported, some skipped for bad FK", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440080",
            title: "Good item",
            type: "note",
            status: "fleeting",
            content: "",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            created: now,
            modified: now,
          },
          {
            id: "550e8400-e29b-41d4-a716-446655440081",
            title: "Bad FK item",
            type: "note",
            status: "fleeting",
            content: "",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            category_id: "550e8400-e29b-41d4-a716-446655440099",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.warnings).toHaveLength(1);
  });
});

// ============================================================
// Import schema — category_id field support
// ============================================================
describe("POST /api/import — category_id field", () => {
  it("rejects import with non-UUID category_id", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440090",
            title: "Bad category_id format",
            type: "note",
            status: "fleeting",
            content: "",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            category_id: "not-a-uuid",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts import with null category_id", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440091",
            title: "Null category_id",
            type: "note",
            status: "fleeting",
            content: "",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            category_id: null,
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
  });

  it("accepts import without category_id (defaults to null)", async () => {
    const now = new Date().toISOString();
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440092",
            title: "No category_id field",
            type: "note",
            status: "fleeting",
            content: "",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: "[]",
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================
// Import — aliases max count consistency
// ============================================================
describe("POST /api/import — aliases max count consistency", () => {
  it("rejects import with more than 10 aliases (consistent with create schema)", async () => {
    const now = new Date().toISOString();
    const tooManyAliases = Array.from({ length: 11 }, (_, i) => `alias-${i}`);
    const res = await app.request("/api/import", {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        items: [
          {
            id: "550e8400-e29b-41d4-a716-446655440095",
            title: "Too many aliases",
            type: "note",
            status: "fleeting",
            content: "",
            priority: null,
            due: null,
            tags: "[]",
            origin: "",
            source: null,
            aliases: JSON.stringify(tooManyAliases),
            created: now,
            modified: now,
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });
});
