import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb } from "../../test-utils.js";
import { createItem, listItems, getItem, searchItems, getAllTags } from "../items.js";

describe("is_private default filtering", () => {
  let db: ReturnType<typeof drizzle>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;

    // Create a public note and a private note
    createItem(db, { title: "Public Note", type: "note" });
    createItem(db, { title: "Private Note", type: "note", is_private: true });
  });

  afterAll(() => {
    sqlite?.close();
  });

  it("listItems excludes private items by default", () => {
    const result = listItems(db, {}, false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.title).toBe("Public Note");
  });

  it("listItems includes private items when is_private=1", () => {
    const result = listItems(db, { is_private: 1 }, false);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.title).toBe("Private Note");
  });

  it("getItem excludes private items by default", () => {
    const all = listItems(db, { is_private: 1 }, false);
    const privateId = all.items[0]!.id;
    expect(getItem(db, privateId, false)).toBeNull();
  });

  it("getItem includes private items when includePrivate=true", () => {
    const all = listItems(db, { is_private: 1 }, false);
    const privateId = all.items[0]!.id;
    expect(getItem(db, privateId, false, true)).not.toBeNull();
  });

  it("searchItems excludes private items by default", () => {
    const results = searchItems(sqlite, db, "Note", 10, false);
    expect(results.every((i) => i.title !== "Private Note")).toBe(true);
  });

  it("searchItems includes private items when includePrivate=true", () => {
    const results = searchItems(sqlite, db, "Note", 10, false, true);
    expect(results.some((i) => i.title === "Private Note")).toBe(true);
  });

  it("getAllTags excludes private item tags", () => {
    const pub = listItems(db, { is_private: 0 }, false).items[0]!;
    const priv = listItems(db, { is_private: 1 }, false).items[0]!;
    sqlite.prepare("UPDATE items SET tags = ? WHERE id = ?").run('["公開標籤"]', pub.id);
    sqlite.prepare("UPDATE items SET tags = ? WHERE id = ?").run('["私密標籤"]', priv.id);

    const tags = getAllTags(sqlite);
    expect(tags).toContain("公開標籤");
    expect(tags).not.toContain("私密標籤");
  });

  it("getAllTags includes private item tags when includePrivate=true", () => {
    const priv = listItems(db, { is_private: 1 }, false).items[0]!;
    sqlite.prepare("UPDATE items SET tags = ? WHERE id = ?").run('["私密標籤"]', priv.id);

    const tags = getAllTags(sqlite, true);
    expect(tags).toContain("私密標籤");
  });

  it("createItem with is_private stores as integer 1", () => {
    const item = createItem(db, { title: "New Private", type: "note", is_private: true });
    const row = sqlite.prepare("SELECT is_private FROM items WHERE id = ?").get(item.id) as {
      is_private: number;
    };
    expect(row.is_private).toBe(1);
  });

  it("createItem without is_private stores as integer 0", () => {
    const item = createItem(db, { title: "New Public", type: "note" });
    const row = sqlite.prepare("SELECT is_private FROM items WHERE id = ?").get(item.id) as {
      is_private: number;
    };
    expect(row.is_private).toBe(0);
  });

  it("getItem with short prefix excludes private items by default", () => {
    const all = listItems(db, { is_private: 1 }, false);
    const privateId = all.items[0]!.id;
    const prefix = privateId.substring(0, 8);
    expect(getItem(db, prefix, false)).toBeNull();
  });

  it("getItem with short prefix includes private items when includePrivate=true", () => {
    const all = listItems(db, { is_private: 1 }, false);
    const privateId = all.items[0]!.id;
    const prefix = privateId.substring(0, 8);
    expect(getItem(db, prefix, false, true)).not.toBeNull();
  });
});
