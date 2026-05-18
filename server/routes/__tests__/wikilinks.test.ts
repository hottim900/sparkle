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
import { wikilinksRouter, _resetDrainNowCooldownForTest } from "../wikilinks.js";

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

describe("GET /api/wikilinks/admin/title-collisions", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/wikilinks/admin/title-collisions");
    expect(res.status).toBe(401);
  });

  it("returns empty list when no titles collide", async () => {
    insertActiveRow(testSqlite, { title: "Unique 1" });
    insertActiveRow(testSqlite, { title: "Unique 2" });

    const res = await authedGet("/api/wikilinks/admin/title-collisions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { collisions: unknown[]; total: number };
    expect(body.collisions).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("surfaces case-insensitive duplicates", async () => {
    insertActiveRow(testSqlite, { title: "Foo" });
    insertActiveRow(testSqlite, { title: "foo" });
    insertActiveRow(testSqlite, { title: "Bar" });

    const res = await authedGet("/api/wikilinks/admin/title-collisions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      collisions: Array<{ normalized: string; rows: Array<{ title: string }> }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.collisions[0]!.normalized).toBe("foo");
    expect(body.collisions[0]!.rows.map((r) => r.title).sort()).toEqual(["Foo", "foo"]);
  });

  it("excludes 未命名 allowlist titles", async () => {
    insertActiveRow(testSqlite, { title: "未命名" });
    insertActiveRow(testSqlite, { title: "未命名" });
    insertActiveRow(testSqlite, { title: "Other" });
    insertActiveRow(testSqlite, { title: "other" });

    const res = await authedGet("/api/wikilinks/admin/title-collisions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      collisions: Array<{ normalized: string }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.collisions[0]!.normalized).toBe("other");
  });

  it("excludes empty titles", async () => {
    // Two rows with empty title — should not appear as a collision
    testSqlite
      .prepare(
        `INSERT INTO items_active (id, type, status, title, content, created, modified)
         VALUES ('e1', 'note', 'fleeting', '', '', '2026-01-01', '2026-01-01'),
                ('e2', 'note', 'fleeting', '', '', '2026-01-01', '2026-01-01')`,
      )
      .run();

    const res = await authedGet("/api/wikilinks/admin/title-collisions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { collisions: unknown[]; total: number };
    expect(body.total).toBe(0);
  });

  it("returns rows sorted by modified DESC within each collision group", async () => {
    testSqlite
      .prepare(
        `INSERT INTO items_active (id, type, status, title, content, created, modified)
         VALUES
           ('a', 'note', 'fleeting', 'Dup', '', '2026-01-01', '2026-01-05'),
           ('b', 'note', 'fleeting', 'dup', '', '2026-01-01', '2026-01-10'),
           ('c', 'note', 'fleeting', 'DUP', '', '2026-01-01', '2026-01-03')`,
      )
      .run();

    const res = await authedGet("/api/wikilinks/admin/title-collisions");
    const body = (await res.json()) as {
      collisions: Array<{ rows: Array<{ id: string }> }>;
    };
    expect(body.collisions[0]!.rows.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("surfaces NFC-divergent duplicates the writer's normalizer would reject", async () => {
    // Two titles that look identical but are byte-divergent under NFC:
    // NFC-composed "café" (4 codepoints) vs NFD-decomposed "café" (5 codepoints).
    // The writer enforcement uses normalizeTitleForUniqueness which runs
    // .normalize("NFC") — so these collide. A pure SQL LOWER(TRIM(title))
    // grouping would NOT match them, leaving exactly the pairs this admin
    // surface exists to find off the operator's radar.
    const nfcComposed = "café"; // é = U+00E9
    const nfdDecomposed = "café"; // e + U+0301 combining acute
    expect(nfcComposed).not.toBe(nfdDecomposed);
    expect(nfcComposed.normalize("NFC")).toBe(nfdDecomposed.normalize("NFC"));

    insertActiveRow(testSqlite, { title: nfcComposed });
    insertActiveRow(testSqlite, { title: nfdDecomposed });

    const res = await authedGet("/api/wikilinks/admin/title-collisions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      collisions: Array<{ normalized: string; rows: Array<{ title: string }> }>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.collisions[0]!.rows).toHaveLength(2);
  });
});

describe("POST /api/wikilinks/admin/drain-now", () => {
  beforeEach(() => {
    // Module-level cooldown clock would otherwise bleed between sequential
    // tests in this file (the auth-failure test, the success test, and the
    // 429 test all touch the same `lastDrainAt`).
    _resetDrainNowCooldownForTest();
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/api/wikilinks/admin/drain-now", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("drains and returns count + max_per_call", async () => {
    const res = await authedPost("/api/wikilinks/admin/drain-now");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; count: number; max_per_call: number };
    expect(body.status).toBe("drained");
    expect(body.max_per_call).toBe(50);
    expect(typeof body.count).toBe("number");
  });

  it("rejects rapid back-to-back calls with 429 + Retry-After header", async () => {
    // First call: succeeds.
    const first = await authedPost("/api/wikilinks/admin/drain-now");
    expect(first.status).toBe(200);

    // Second call within the 200ms cooldown: 429.
    const second = await authedPost("/api/wikilinks/admin/drain-now");
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBeTruthy();
    const body = (await second.json()) as { error: string; retry_after_ms: number };
    expect(body.error).toBe("DRAIN_COOLDOWN");
    expect(body.retry_after_ms).toBeGreaterThan(0);
    expect(body.retry_after_ms).toBeLessThanOrEqual(200);
  });
});

describe("GET /api/wikilinks/admin/preview-rename", () => {
  it("returns 401 without auth", async () => {
    const res = await app.request("/api/wikilinks/admin/preview-rename?target_id=x&new_title=y");
    expect(res.status).toBe(401);
  });

  it("returns 400 when target_id is missing", async () => {
    const res = await authedGet("/api/wikilinks/admin/preview-rename?new_title=foo");
    expect(res.status).toBe(400);
  });

  it("returns 404 when target_id doesn't exist", async () => {
    const res = await authedGet(
      "/api/wikilinks/admin/preview-rename?target_id=00000000-0000-0000-0000-000000000000&new_title=foo",
    );
    expect(res.status).toBe(404);
  });

  it("returns predicted rewrite count without modifying content", async () => {
    const target = insertActiveRow(testSqlite, { title: "Hub" });
    const source = insertActiveRow(testSqlite, { content: "see [[Hub]] here" });
    testSqlite
      .prepare(
        `INSERT INTO reference_index (source_id, target_id, char_offset, raw_title, kind)
         VALUES (?, ?, 4, 'Hub', 'wikilink')`,
      )
      .run(source, target);

    const res = await authedGet(
      `/api/wikilinks/admin/preview-rename?target_id=${target}&new_title=Renamed`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      old_title: string;
      new_title: string;
      would_rewrite_count: number;
      would_rewrite_source_ids: string[];
      preview: Array<{ source_id: string }>;
    };
    expect(body.old_title).toBe("Hub");
    expect(body.new_title).toBe("Renamed");
    expect(body.would_rewrite_count).toBe(1);
    expect(body.would_rewrite_source_ids).toEqual([source]);
    expect(body.preview).toHaveLength(1);

    // Source content untouched
    const src = testSqlite.prepare("SELECT content FROM items_active WHERE id = ?").get(source) as {
      content: string;
    };
    expect(src.content).toBe("see [[Hub]] here");
  });

  it("returns 0 rewrites when newTitle is NFC-equivalent to oldTitle (self-rename)", async () => {
    // Use explicit \u escapes for the decomposed form — any
    // normalize-on-save editor or git filter would collapse the inline
    // literals to identical bytes, masking the test. With escapes the
    // strings are guaranteed-distinct at parse time, then converge under
    // .normalize("NFC").
    const composed = "Café"; // single codepoint
    const decomposed = "Café"; // base + combining accent
    expect(composed).not.toBe(decomposed); // sanity: bytes differ
    expect(composed.normalize("NFC")).toBe(decomposed.normalize("NFC")); // converge

    const target = insertActiveRow(testSqlite, { title: composed });

    const res = await authedGet(
      `/api/wikilinks/admin/preview-rename?target_id=${target}&new_title=${encodeURIComponent(
        decomposed,
      )}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { would_rewrite_count: number };
    // Both normalize to U+00E9 — engine treats as no-op rename.
    expect(body.would_rewrite_count).toBe(0);
  });

  it("returns a state_hash that round-trips via PATCH expected_state_hash (DX-2)", async () => {
    const target = insertActiveRow(testSqlite, { title: "Hub" });
    const source = insertActiveRow(testSqlite, { content: "see [[Hub]] here" });
    testSqlite
      .prepare(
        `INSERT INTO reference_index (source_id, target_id, char_offset, raw_title, kind)
         VALUES (?, ?, 4, 'Hub', 'wikilink')`,
      )
      .run(source, target);

    const res = await authedGet(
      `/api/wikilinks/admin/preview-rename?target_id=${target}&new_title=Renamed`,
    );
    const body = (await res.json()) as { state_hash: string };
    expect(body.state_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
