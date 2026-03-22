import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb } from "../../test-utils.js";
import { createItem } from "../items.js";
import { getStats } from "../stats.js";

describe("stats exclude private items", () => {
  let db: ReturnType<typeof drizzle>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;

    createItem(db, { title: "Public Fleeting", type: "note", status: "fleeting" });
    createItem(db, {
      title: "Private Fleeting",
      type: "note",
      status: "fleeting",
      is_private: true,
    });
    createItem(db, { title: "Public Todo", type: "todo", status: "active" });
    createItem(db, { title: "Private Todo", type: "todo", status: "active", is_private: true });
  });

  afterAll(() => {
    sqlite?.close();
  });

  it("getStats excludes private items from counts", () => {
    const stats = getStats(sqlite);
    expect(stats.fleeting_count).toBe(1);
    expect(stats.active_count).toBe(1);
  });

  it("getStats counts only public created items", () => {
    const stats = getStats(sqlite);
    // 2 public items created this week
    expect(stats.created_this_week).toBe(2);
  });
});
