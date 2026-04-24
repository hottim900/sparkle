import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb, insertVaultRow } from "../../test-utils.js";
import { createItem } from "../items.js";
import { getRecentItems, getWeekData, getCategoryDistribution, toLocalDateStr } from "../stats.js";
import { drizzle } from "drizzle-orm/better-sqlite3";

describe("getRecentItems — items_active + items_vault merge", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle>;

  beforeEach(() => {
    const t = createTestDb();
    sqlite = t.sqlite;
    db = t.db;
  });

  afterEach(() => {
    sqlite?.close();
  });

  it("includes vault rows whose exported_at falls inside the window", () => {
    createItem(db, { title: "Active note", type: "note", status: "fleeting" });
    const recent = new Date();
    insertVaultRow(sqlite, {
      title: "Vault note",
      exported_at: recent.toISOString(),
    });

    const result = getRecentItems(sqlite, 7, 10, 0);
    expect(result.total).toBe(2);
    const titles = result.items.map((i) => i.title);
    expect(titles).toContain("Vault note");
    const vaultItem = result.items.find((i) => i.title === "Vault note")!;
    expect(vaultItem.activity).toBe("exported");
    expect(vaultItem.status).toBe("exported");
    expect(vaultItem.type).toBe("note");
  });

  it("skips vault rows whose exported_at is outside the window", () => {
    const old = new Date(Date.now() - 30 * 86400_000).toISOString();
    insertVaultRow(sqlite, { title: "Old vault", exported_at: old });

    const result = getRecentItems(sqlite, 7, 10, 0);
    expect(result.items.find((i) => i.title === "Old vault")).toBeUndefined();
  });

  it("excludes is_private vault rows", () => {
    insertVaultRow(sqlite, {
      title: "Private vault",
      exported_at: new Date().toISOString(),
      is_private: 1,
    });
    const result = getRecentItems(sqlite, 7, 10, 0);
    expect(result.items.find((i) => i.title === "Private vault")).toBeUndefined();
  });

  it("sorts merged items by modified/exported_at DESC", () => {
    const nowMs = Date.now();
    // Active note updated 2 days ago
    const activeOld = new Date(nowMs - 2 * 86400_000).toISOString();
    sqlite
      .prepare(
        `INSERT INTO items_active (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified, is_private, viewed_at)
         VALUES ('a1', 'note', 'Older active', '', 'fleeting', NULL, NULL, '[]', '', NULL, '[]', ?, ?, 0, NULL)`,
      )
      .run(activeOld, activeOld);
    // Vault exported 1 hour ago
    insertVaultRow(sqlite, {
      title: "Newer vault",
      exported_at: new Date(nowMs - 3600_000).toISOString(),
    });

    const result = getRecentItems(sqlite, 7, 10, 0);
    expect(result.items[0]!.title).toBe("Newer vault");
    expect(result.items[1]!.title).toBe("Older active");
  });

  it("applies limit/offset across the union", () => {
    for (let i = 0; i < 3; i++) {
      insertVaultRow(sqlite, {
        title: `V${i}`,
        exported_at: new Date(Date.now() - i * 3600_000).toISOString(),
      });
    }
    const page = getRecentItems(sqlite, 7, 2, 1);
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]!.title).toBe("V1");
  });

  it("interleaves active + vault rows and paginates across both sides", () => {
    const nowMs = Date.now();
    // Insert at descending timestamps so order is deterministic:
    // A0 (now), V0 (now-1h), A1 (now-2h), V1 (now-3h)
    sqlite
      .prepare(
        `INSERT INTO items_active (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified, is_private, viewed_at)
         VALUES ('a0','note','A0','','fleeting',NULL,NULL,'[]','',NULL,'[]',?,?,0,NULL)`,
      )
      .run(new Date(nowMs).toISOString(), new Date(nowMs).toISOString());
    insertVaultRow(sqlite, {
      title: "V0",
      exported_at: new Date(nowMs - 3600_000).toISOString(),
    });
    sqlite
      .prepare(
        `INSERT INTO items_active (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified, is_private, viewed_at)
         VALUES ('a1','note','A1','','fleeting',NULL,NULL,'[]','',NULL,'[]',?,?,0,NULL)`,
      )
      .run(
        new Date(nowMs - 2 * 3600_000).toISOString(),
        new Date(nowMs - 2 * 3600_000).toISOString(),
      );
    insertVaultRow(sqlite, {
      title: "V1",
      exported_at: new Date(nowMs - 3 * 3600_000).toISOString(),
    });

    const page1 = getRecentItems(sqlite, 7, 2, 0);
    expect(page1.total).toBe(4);
    expect(page1.items.map((i) => i.title)).toEqual(["A0", "V0"]);

    const page2 = getRecentItems(sqlite, 7, 2, 2);
    expect(page2.items.map((i) => i.title)).toEqual(["A1", "V1"]);
    expect(page2.items.map((i) => i.activity)).toEqual(["created", "exported"]);
  });
});

describe("getWeekData — items_vault contributes to notes_modified", () => {
  let sqlite: Database.Database;

  // Monday 2026-03-23 local
  const monday = "2026-03-23";

  beforeEach(() => {
    const t = createTestDb();
    sqlite = t.sqlite;
  });

  afterEach(() => {
    sqlite?.close();
  });

  it("buckets a vault export into the notes_modified list for its exported_at day", () => {
    // Build a local-midnight ISO for Wednesday 2026-03-25
    const wed = new Date(2026, 2, 25, 10, 0, 0).toISOString();
    insertVaultRow(sqlite, { title: "Exported on Wed", exported_at: wed });

    const result = getWeekData(sqlite, monday);
    const wedDay = result.days.find((d) => d.date === toLocalDateStr(new Date(2026, 2, 25)))!;
    expect(wedDay).toBeDefined();
    expect(wedDay.notes_modified.map((n) => n.title)).toContain("Exported on Wed");
    const entry = wedDay.notes_modified.find((n) => n.title === "Exported on Wed")!;
    expect(entry.status).toBe("exported");
  });

  it("skips private vault rows from week view", () => {
    const wed = new Date(2026, 2, 25, 10, 0, 0).toISOString();
    insertVaultRow(sqlite, {
      title: "Private exported",
      exported_at: wed,
      is_private: 1,
    });
    const result = getWeekData(sqlite, monday);
    for (const day of result.days) {
      expect(day.notes_modified.find((n) => n.title === "Private exported")).toBeUndefined();
    }
  });
});

describe("getCategoryDistribution — merges items_active + items_vault by category_id", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    const t = createTestDb();
    sqlite = t.sqlite;
    sqlite
      .prepare(
        `INSERT INTO categories (id, name, sort_order, color, created, modified)
         VALUES ('cat-1', '工作', 0, '#ff0000', datetime('now'), datetime('now'))`,
      )
      .run();
  });

  afterEach(() => {
    sqlite?.close();
  });

  it("sums counts across both tables for the same category", () => {
    sqlite
      .prepare(
        `INSERT INTO items_active (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified, is_private, category_id, paused)
         VALUES ('a1', 'note', 'Active', '', 'fleeting', NULL, NULL, '[]', '', NULL, '[]', datetime('now'), datetime('now'), 0, 'cat-1', 0)`,
      )
      .run();
    insertVaultRow(sqlite, { title: "Vault", category_id: "cat-1" });

    const dist = getCategoryDistribution(sqlite);
    const work = dist.find((d) => d.category_id === "cat-1")!;
    expect(work.count).toBe(2);
    expect(work.color).toBe("#ff0000");
    expect(work.category_name).toBe("工作");
  });

  it("vault-only categories still appear", () => {
    insertVaultRow(sqlite, { title: "Vault only", category_id: "cat-1" });
    const dist = getCategoryDistribution(sqlite);
    expect(dist.find((d) => d.category_id === "cat-1")!.count).toBe(1);
  });

  it("uncategorized vault rows merge into the null bucket", () => {
    insertVaultRow(sqlite, { title: "Uncat vault", category_id: null });
    const dist = getCategoryDistribution(sqlite);
    const nullBucket = dist.find((d) => d.category_id === null)!;
    expect(nullBucket.count).toBe(1);
    expect(nullBucket.category_name).toBe("未分類");
  });
});
