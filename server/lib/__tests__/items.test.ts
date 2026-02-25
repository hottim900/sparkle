import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema.js";
import { setupFTS } from "../../db/fts.js";
import {
  createItem,
  getItem,
  listItems,
  updateItem,
  deleteItem,
  searchItems,
  getAllTags,
  isValidTypeStatus,
  getAutoMappedStatus,
} from "../items.js";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");

  sqlite.exec(`
    CREATE TABLE items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'note',
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'fleeting',
      priority TEXT,
      due TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      origin TEXT DEFAULT '',
      source TEXT DEFAULT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );
    CREATE INDEX idx_items_status ON items(status);
    CREATE INDEX idx_items_type ON items(type);
    CREATE INDEX idx_items_created ON items(created DESC);
  `);

  setupFTS(sqlite);

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

describe("Data Access Layer", () => {
  let db: ReturnType<typeof drizzle>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  afterAll(() => {
    sqlite?.close();
  });

  describe("createItem", () => {
    it("creates a note with defaults (status=fleeting)", () => {
      const item = createItem(db, { title: "Test note" });
      expect(item.title).toBe("Test note");
      expect(item.type).toBe("note");
      expect(item.status).toBe("fleeting");
      expect(item.id).toBeTruthy();
      expect(item.created).toBeTruthy();
      expect(item.modified).toBeTruthy();
    });

    it("creates a todo with default status=active", () => {
      const item = createItem(db, { title: "Test todo", type: "todo" });
      expect(item.type).toBe("todo");
      expect(item.status).toBe("active");
    });

    it("creates an item with all fields", () => {
      const item = createItem(db, {
        title: "Buy groceries",
        type: "todo",
        content: "Milk, eggs, bread",
        status: "active",
        priority: "high",
        due: "2026-03-01",
        tags: ["shopping", "errands"],
        origin: "web",
        source: "https://example.com",
        aliases: ["grocery-run"],
      });
      expect(item.type).toBe("todo");
      expect(item.status).toBe("active");
      expect(item.priority).toBe("high");
      expect(item.due).toBe("2026-03-01");
      expect(JSON.parse(item.tags)).toEqual(["shopping", "errands"]);
      expect(item.origin).toBe("web");
      expect(item.source).toBe("https://example.com");
      expect(JSON.parse(item.aliases)).toEqual(["grocery-run"]);
    });
  });

  describe("getItem", () => {
    it("returns an item by id", () => {
      const created = createItem(db, { title: "Find me" });
      const found = getItem(db, created.id);
      expect(found).toBeTruthy();
      expect(found!.title).toBe("Find me");
    });

    it("returns null for non-existent id", () => {
      const found = getItem(db, "non-existent-id");
      expect(found).toBeNull();
    });
  });

  describe("listItems", () => {
    it("returns all items", () => {
      createItem(db, { title: "Item 1" });
      createItem(db, { title: "Item 2" });
      createItem(db, { title: "Item 3" });
      const result = listItems(db);
      expect(result.items).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it("filters by status", () => {
      createItem(db, { title: "Fleeting item" });
      createItem(db, { title: "Developing item", status: "developing" });
      const result = listItems(db, { status: "developing" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.title).toBe("Developing item");
    });

    it("filters by excludeStatus", () => {
      createItem(db, { title: "Fleeting" });
      createItem(db, { title: "Developing", status: "developing" });
      createItem(db, { title: "Archived", status: "archived" });
      const result = listItems(db, { excludeStatus: ["archived"] });
      expect(result.items).toHaveLength(2);
      expect(result.items.map((i: { title: string }) => i.title).sort()).toEqual(["Developing", "Fleeting"]);
    });

    it("filters by type", () => {
      createItem(db, { title: "A note", type: "note" });
      createItem(db, { title: "A todo", type: "todo" });
      const result = listItems(db, { type: "todo" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.title).toBe("A todo");
    });

    it("filters by tag", () => {
      createItem(db, { title: "Tagged", tags: ["work", "urgent"] });
      createItem(db, { title: "Not tagged" });
      const result = listItems(db, { tag: "work" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.title).toBe("Tagged");
    });

    it("supports pagination", () => {
      for (let i = 0; i < 5; i++) {
        createItem(db, { title: `Item ${i}` });
      }
      const page1 = listItems(db, { limit: 2, offset: 0 });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);

      const page2 = listItems(db, { limit: 2, offset: 2 });
      expect(page2.items).toHaveLength(2);
    });

    it("returns items in newest-first order", () => {
      // Insert directly with explicit timestamps to avoid same-ms issues
      const { v4: uuidv4 } = require("uuid");
      for (const [title, ts] of [
        ["First", "2026-01-01T00:00:00.000Z"],
        ["Second", "2026-01-02T00:00:00.000Z"],
        ["Third", "2026-01-03T00:00:00.000Z"],
      ] as const) {
        sqlite.prepare(
          "INSERT INTO items (id, title, type, status, tags, origin, aliases, created, modified) VALUES (?, ?, 'note', 'fleeting', '[]', '', '[]', ?, ?)",
        ).run(uuidv4(), title, ts, ts);
      }
      const result = listItems(db);
      expect(result.items[0]!.title).toBe("Third");
      expect(result.items[2]!.title).toBe("First");
    });
  });

  describe("updateItem", () => {
    it("updates specified fields", () => {
      const item = createItem(db, { title: "Original", type: "todo" });
      const updated = updateItem(db, item.id, {
        title: "Updated",
        status: "done",
      });
      expect(updated).toBeTruthy();
      expect(updated!.title).toBe("Updated");
      expect(updated!.status).toBe("done");
    });

    it("updates modified timestamp", async () => {
      const item = createItem(db, { title: "Test" });
      // Wait 5ms to ensure different timestamp
      await new Promise((r) => setTimeout(r, 5));
      const updated = updateItem(db, item.id, { title: "Changed" });
      expect(updated!.modified).not.toBe(item.modified);
    });

    it("returns null for non-existent id", () => {
      const result = updateItem(db, "non-existent", { title: "New" });
      expect(result).toBeNull();
    });

    it("updates tags", () => {
      const item = createItem(db, { title: "Tag test" });
      const updated = updateItem(db, item.id, { tags: ["new-tag"] });
      expect(JSON.parse(updated!.tags)).toEqual(["new-tag"]);
    });

    it("auto-maps status on type conversion (note→todo)", () => {
      const item = createItem(db, { title: "Note", type: "note" }); // fleeting
      const updated = updateItem(db, item.id, { type: "todo" });
      expect(updated!.type).toBe("todo");
      expect(updated!.status).toBe("active"); // fleeting → active
    });

    it("auto-maps status on type conversion (todo→note)", () => {
      const item = createItem(db, { title: "Todo", type: "todo" }); // active
      const updated = updateItem(db, item.id, { type: "note" });
      expect(updated!.type).toBe("note");
      expect(updated!.status).toBe("fleeting"); // active → fleeting
    });

    it("reverts exported note to permanent when title changes", () => {
      const item = createItem(db, { title: "Note", type: "note", status: "exported" });
      const updated = updateItem(db, item.id, { title: "Changed title" });
      expect(updated!.status).toBe("permanent");
    });

    it("does NOT revert exported note when non-content fields change", () => {
      const item = createItem(db, { title: "Note", type: "note", status: "exported" });
      const updated = updateItem(db, item.id, { tags: ["new-tag"] });
      expect(updated!.status).toBe("exported");
    });
  });

  describe("deleteItem", () => {
    it("deletes an item", () => {
      const item = createItem(db, { title: "Delete me" });
      const deleted = deleteItem(db, item.id);
      expect(deleted).toBe(true);
      expect(getItem(db, item.id)).toBeNull();
    });

    it("returns false for non-existent id", () => {
      const result = deleteItem(db, "non-existent");
      expect(result).toBe(false);
    });
  });

  describe("searchItems", () => {
    it("finds items by title", () => {
      createItem(db, { title: "Meeting notes for project Alpha" });
      createItem(db, { title: "Grocery list" });
      const results = searchItems(sqlite, "project Alpha");
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe("Meeting notes for project Alpha");
    });

    it("finds items by content", () => {
      createItem(db, {
        title: "My note",
        content: "Remember to buy milk and eggs",
      });
      const results = searchItems(sqlite, "milk eggs");
      expect(results).toHaveLength(1);
    });

    it("returns empty array for no matches", () => {
      createItem(db, { title: "Something" });
      const results = searchItems(sqlite, "nonexistent");
      expect(results).toHaveLength(0);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        createItem(db, { title: `Search result ${i}` });
      }
      const results = searchItems(sqlite, "Search result", 2);
      expect(results).toHaveLength(2);
    });
  });

  describe("getAllTags", () => {
    it("returns unique tags", () => {
      createItem(db, { title: "Item 1", tags: ["work", "urgent"] });
      createItem(db, { title: "Item 2", tags: ["work", "personal"] });
      createItem(db, { title: "Item 3", tags: ["personal"] });
      const tags = getAllTags(sqlite);
      expect(tags.sort()).toEqual(["personal", "urgent", "work"]);
    });

    it("returns empty array when no tags", () => {
      createItem(db, { title: "No tags" });
      const tags = getAllTags(sqlite);
      expect(tags).toEqual([]);
    });
  });

  describe("isValidTypeStatus", () => {
    it("accepts fleeting/developing/permanent/exported/archived for notes", () => {
      expect(isValidTypeStatus("note", "fleeting")).toBe(true);
      expect(isValidTypeStatus("note", "developing")).toBe(true);
      expect(isValidTypeStatus("note", "permanent")).toBe(true);
      expect(isValidTypeStatus("note", "exported")).toBe(true);
      expect(isValidTypeStatus("note", "archived")).toBe(true);
    });

    it("rejects active/done for notes", () => {
      expect(isValidTypeStatus("note", "active")).toBe(false);
      expect(isValidTypeStatus("note", "done")).toBe(false);
    });

    it("accepts active/done/archived for todos", () => {
      expect(isValidTypeStatus("todo", "active")).toBe(true);
      expect(isValidTypeStatus("todo", "done")).toBe(true);
      expect(isValidTypeStatus("todo", "archived")).toBe(true);
    });

    it("rejects fleeting/developing/permanent/exported for todos", () => {
      expect(isValidTypeStatus("todo", "fleeting")).toBe(false);
      expect(isValidTypeStatus("todo", "developing")).toBe(false);
      expect(isValidTypeStatus("todo", "permanent")).toBe(false);
      expect(isValidTypeStatus("todo", "exported")).toBe(false);
    });
  });

  describe("getAutoMappedStatus", () => {
    it("returns null when types are the same", () => {
      expect(getAutoMappedStatus("note", "note", "fleeting")).toBeNull();
      expect(getAutoMappedStatus("todo", "todo", "active")).toBeNull();
    });

    it("maps todo(done) -> note to permanent", () => {
      expect(getAutoMappedStatus("todo", "note", "done")).toBe("permanent");
    });

    it("maps note(developing) -> todo to active", () => {
      expect(getAutoMappedStatus("note", "todo", "developing")).toBe("active");
    });

    it("maps note(permanent) -> todo to done", () => {
      expect(getAutoMappedStatus("note", "todo", "permanent")).toBe("done");
    });

    it("maps note(exported) -> todo to done", () => {
      expect(getAutoMappedStatus("note", "todo", "exported")).toBe("done");
    });

    it("maps archived -> any type to archived", () => {
      expect(getAutoMappedStatus("note", "todo", "archived")).toBe("archived");
      expect(getAutoMappedStatus("todo", "note", "archived")).toBe("archived");
    });
  });

  describe("updateItem — type conversion", () => {
    it("auto-maps todo(done) -> note to permanent", () => {
      const item = createItem(db, { title: "Done todo", type: "todo", status: "done" });
      const updated = updateItem(db, item.id, { type: "note" });
      expect(updated!.type).toBe("note");
      expect(updated!.status).toBe("permanent");
    });

    it("auto-maps note(developing) -> todo to active", () => {
      const item = createItem(db, { title: "Dev note", type: "note", status: "developing" });
      const updated = updateItem(db, item.id, { type: "todo" });
      expect(updated!.type).toBe("todo");
      expect(updated!.status).toBe("active");
    });

    it("auto-maps note(permanent) -> todo to done", () => {
      const item = createItem(db, { title: "Perm note", type: "note", status: "permanent" });
      const updated = updateItem(db, item.id, { type: "todo" });
      expect(updated!.type).toBe("todo");
      expect(updated!.status).toBe("done");
    });

    it("auto-maps note(exported) -> todo to done", () => {
      const item = createItem(db, { title: "Exported note", type: "note", status: "exported" });
      const updated = updateItem(db, item.id, { type: "todo" });
      expect(updated!.type).toBe("todo");
      expect(updated!.status).toBe("done");
    });

    it("preserves archived status across type conversion", () => {
      const noteItem = createItem(db, { title: "Archived note", type: "note", status: "archived" });
      const updated1 = updateItem(db, noteItem.id, { type: "todo" });
      expect(updated1!.type).toBe("todo");
      expect(updated1!.status).toBe("archived");

      const todoItem = createItem(db, { title: "Archived todo", type: "todo", status: "archived" });
      const updated2 = updateItem(db, todoItem.id, { type: "note" });
      expect(updated2!.type).toBe("note");
      expect(updated2!.status).toBe("archived");
    });
  });

  describe("updateItem — exported auto-reversion edge cases", () => {
    it("reverts exported to permanent when content changes", () => {
      const item = createItem(db, { title: "Note", content: "original", type: "note", status: "exported" });
      const updated = updateItem(db, item.id, { content: "changed content" });
      expect(updated!.status).toBe("permanent");
    });

    it("does NOT revert exported when same title is set", () => {
      const item = createItem(db, { title: "Note", type: "note", status: "exported" });
      const updated = updateItem(db, item.id, { title: "Note" });
      expect(updated!.status).toBe("exported");
    });

    it("does NOT revert exported when same content is set", () => {
      const item = createItem(db, { title: "Note", content: "original", type: "note", status: "exported" });
      const updated = updateItem(db, item.id, { content: "original" });
      expect(updated!.status).toBe("exported");
    });
  });
});
