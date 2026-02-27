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
      linked_note_id TEXT DEFAULT NULL,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );
    CREATE INDEX idx_items_status ON items(status);
    CREATE INDEX idx_items_type ON items(type);
    CREATE INDEX idx_items_created ON items(created DESC);

    CREATE TABLE share_tokens (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      visibility TEXT NOT NULL DEFAULT 'unlisted',
      created TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_share_tokens_token ON share_tokens(token);
    CREATE INDEX idx_share_tokens_item_id ON share_tokens(item_id);
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

    it("ignores due for notes", () => {
      const item = createItem(db, { title: "Note with due", type: "note", due: "2026-03-01" });
      expect(item.type).toBe("note");
      expect(item.due).toBeNull();
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

    it("sorts by modified descending", () => {
      const { v4: uuidv4 } = require("uuid");
      // Insert items with different modified timestamps
      for (const [title, created, modified] of [
        ["OldModified", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
        ["MidModified", "2026-01-02T00:00:00.000Z", "2026-01-05T00:00:00.000Z"],
        ["NewModified", "2026-01-03T00:00:00.000Z", "2026-01-10T00:00:00.000Z"],
      ] as const) {
        sqlite.prepare(
          "INSERT INTO items (id, title, type, status, tags, origin, aliases, created, modified) VALUES (?, ?, 'note', 'fleeting', '[]', '', '[]', ?, ?)",
        ).run(uuidv4(), title, created, modified);
      }
      const result = listItems(db, { sort: "modified", order: "desc" });
      expect(result.items[0]!.title).toBe("NewModified");
      expect(result.items[2]!.title).toBe("OldModified");
    });

    it("sorts by modified ascending", () => {
      const { v4: uuidv4 } = require("uuid");
      for (const [title, created, modified] of [
        ["OldModified", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
        ["MidModified", "2026-01-02T00:00:00.000Z", "2026-01-05T00:00:00.000Z"],
        ["NewModified", "2026-01-03T00:00:00.000Z", "2026-01-10T00:00:00.000Z"],
      ] as const) {
        sqlite.prepare(
          "INSERT INTO items (id, title, type, status, tags, origin, aliases, created, modified) VALUES (?, ?, 'note', 'fleeting', '[]', '', '[]', ?, ?)",
        ).run(uuidv4(), title, created, modified);
      }
      const result = listItems(db, { sort: "modified", order: "asc" });
      expect(result.items[0]!.title).toBe("OldModified");
      expect(result.items[2]!.title).toBe("NewModified");
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

    it("ignores due update for notes", () => {
      const item = createItem(db, { title: "A note", type: "note" });
      const updated = updateItem(db, item.id, { due: "2026-03-01" });
      expect(updated!.due).toBeNull();
    });

    it("auto-maps status on type conversion (note→todo)", () => {
      const item = createItem(db, { title: "Note", type: "note" }); // fleeting
      const updated = updateItem(db, item.id, { type: "todo" });
      expect(updated!.type).toBe("todo");
      expect(updated!.status).toBe("active"); // fleeting → active
    });

    it("auto-maps status on type conversion (todo→note)", () => {
      const item = createItem(db, { title: "Todo", type: "todo", due: "2026-03-01" }); // active
      const updated = updateItem(db, item.id, { type: "note" });
      expect(updated!.type).toBe("note");
      expect(updated!.status).toBe("fleeting"); // active → fleeting
      expect(updated!.due).toBeNull(); // due cleared on todo→note conversion
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
      const results = searchItems(sqlite, db, "project Alpha");
      expect(results).toHaveLength(1);
      expect(results[0]!.title).toBe("Meeting notes for project Alpha");
    });

    it("finds items by content", () => {
      createItem(db, {
        title: "My note",
        content: "Remember to buy milk and eggs",
      });
      const results = searchItems(sqlite, db, "milk eggs");
      expect(results).toHaveLength(1);
    });

    it("returns empty array for no matches", () => {
      createItem(db, { title: "Something" });
      const results = searchItems(sqlite, db, "nonexistent");
      expect(results).toHaveLength(0);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) {
        createItem(db, { title: `Search result ${i}` });
      }
      const results = searchItems(sqlite, db, "Search result", 2);
      expect(results).toHaveLength(2);
    });

    it("returns enriched fields (share_visibility, linked_note_title, linked_todo_count)", () => {
      const note = createItem(db, { title: "Searchable note for enrichment" });
      // Create a share for the note
      const shareId = crypto.randomUUID();
      const token = crypto.randomUUID().slice(0, 12);
      sqlite.prepare(
        "INSERT INTO share_tokens (id, item_id, token, visibility, created) VALUES (?, ?, ?, ?, ?)",
      ).run(shareId, note.id, token, "public", new Date().toISOString());
      // Create a linked todo
      createItem(db, { title: "Linked todo for search", type: "todo", linked_note_id: note.id });

      const results = searchItems(sqlite, db, "Searchable note for enrichment");
      expect(results).toHaveLength(1);
      expect(results[0]!.share_visibility).toBe("public");
      expect(results[0]!.linked_todo_count).toBe(1);
      expect(results[0]!.linked_note_title).toBeNull();
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

    it("validates scratch type statuses", () => {
      expect(isValidTypeStatus("scratch", "draft")).toBe(true);
      expect(isValidTypeStatus("scratch", "archived")).toBe(true);
      expect(isValidTypeStatus("scratch", "fleeting")).toBe(false);
      expect(isValidTypeStatus("scratch", "active")).toBe(false);
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

    it("maps scratch → note statuses", () => {
      expect(getAutoMappedStatus("scratch", "note", "draft")).toBe("fleeting");
      expect(getAutoMappedStatus("scratch", "note", "archived")).toBe("archived");
    });

    it("maps scratch → todo statuses", () => {
      expect(getAutoMappedStatus("scratch", "todo", "draft")).toBe("active");
      expect(getAutoMappedStatus("scratch", "todo", "archived")).toBe("archived");
    });

    it("maps note → scratch statuses", () => {
      expect(getAutoMappedStatus("note", "scratch", "fleeting")).toBe("draft");
      expect(getAutoMappedStatus("note", "scratch", "developing")).toBe("draft");
      expect(getAutoMappedStatus("note", "scratch", "permanent")).toBe("archived");
      expect(getAutoMappedStatus("note", "scratch", "exported")).toBe("archived");
      expect(getAutoMappedStatus("note", "scratch", "archived")).toBe("archived");
    });

    it("maps todo → scratch statuses", () => {
      expect(getAutoMappedStatus("todo", "scratch", "active")).toBe("draft");
      expect(getAutoMappedStatus("todo", "scratch", "done")).toBe("archived");
      expect(getAutoMappedStatus("todo", "scratch", "archived")).toBe("archived");
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

  describe("linked_note_id", () => {
    it("createItem with linked_note_id stores it on todo", () => {
      const note = createItem(db, { title: "My note", type: "note" });
      const todo = createItem(db, {
        title: "Track note",
        type: "todo",
        linked_note_id: note.id,
      });
      expect(todo.linked_note_id).toBe(note.id);
    });

    it("createItem note ignores linked_note_id", () => {
      const note1 = createItem(db, { title: "Note 1", type: "note" });
      const note2 = createItem(db, {
        title: "Note 2",
        type: "note",
        linked_note_id: note1.id,
      });
      expect(note2.linked_note_id).toBeNull();
    });

    it("updateItem can set linked_note_id on todo", () => {
      const note = createItem(db, { title: "My note", type: "note" });
      const todo = createItem(db, { title: "My todo", type: "todo" });
      const updated = updateItem(db, todo.id, { linked_note_id: note.id });
      expect(updated!.linked_note_id).toBe(note.id);
    });

    it("updateItem can clear linked_note_id on todo", () => {
      const note = createItem(db, { title: "My note", type: "note" });
      const todo = createItem(db, {
        title: "My todo",
        type: "todo",
        linked_note_id: note.id,
      });
      const updated = updateItem(db, todo.id, { linked_note_id: null });
      expect(updated!.linked_note_id).toBeNull();
    });

    it("updateItem ignores linked_note_id on note", () => {
      const note1 = createItem(db, { title: "Note 1", type: "note" });
      const note2 = createItem(db, { title: "Note 2", type: "note" });
      const updated = updateItem(db, note2.id, { linked_note_id: note1.id });
      expect(updated!.linked_note_id).toBeNull();
    });

    it("todo→note clears linked_note_id", () => {
      const note = createItem(db, { title: "My note", type: "note" });
      const todo = createItem(db, {
        title: "Track note",
        type: "todo",
        linked_note_id: note.id,
      });
      const updated = updateItem(db, todo.id, { type: "note" });
      expect(updated!.type).toBe("note");
      expect(updated!.linked_note_id).toBeNull();
    });
  });

  describe("linked_note_title resolution", () => {
    it("getItem returns linked_note_title for todo with linked_note_id", () => {
      const note = createItem(db, { title: "My linked note", type: "note" });
      const todo = createItem(db, {
        title: "Track note",
        type: "todo",
        linked_note_id: note.id,
      });
      const fetched = getItem(db, todo.id);
      expect(fetched!.linked_note_title).toBe("My linked note");
    });

    it("getItem returns null linked_note_title when no linked_note_id", () => {
      const todo = createItem(db, { title: "Plain todo", type: "todo" });
      const fetched = getItem(db, todo.id);
      expect(fetched!.linked_note_title).toBeNull();
    });

    it("getItem returns null linked_note_title for note items", () => {
      const note = createItem(db, { title: "A note", type: "note" });
      const fetched = getItem(db, note.id);
      expect(fetched!.linked_note_title).toBeNull();
    });

    it("getItem returns null linked_note_title when linked note is deleted", () => {
      const note = createItem(db, { title: "Will be deleted", type: "note" });
      const todo = createItem(db, {
        title: "Track note",
        type: "todo",
        linked_note_id: note.id,
      });
      deleteItem(db, note.id);
      const fetched = getItem(db, todo.id);
      expect(fetched!.linked_note_id).toBe(note.id);
      expect(fetched!.linked_note_title).toBeNull();
    });

    it("listItems returns linked_note_title for items with linked_note_id", () => {
      const note = createItem(db, { title: "Reference note", type: "note" });
      createItem(db, {
        title: "Linked todo",
        type: "todo",
        linked_note_id: note.id,
      });
      createItem(db, { title: "Plain todo", type: "todo" });
      const result = listItems(db, { type: "todo" });
      const linked = result.items.find((i) => i.title === "Linked todo");
      const plain = result.items.find((i) => i.title === "Plain todo");
      expect(linked!.linked_note_title).toBe("Reference note");
      expect(plain!.linked_note_title).toBeNull();
    });
  });

  describe("linked_todo_count resolution", () => {
    it("getItem returns linked_todo_count for note with linked todos", () => {
      const note = createItem(db, { title: "My note", type: "note" });
      createItem(db, { title: "Todo 1", type: "todo", linked_note_id: note.id });
      createItem(db, { title: "Todo 2", type: "todo", linked_note_id: note.id });
      const fetched = getItem(db, note.id);
      expect(fetched!.linked_todo_count).toBe(2);
    });

    it("getItem returns 0 linked_todo_count when no linked todos", () => {
      const note = createItem(db, { title: "Lonely note", type: "note" });
      const fetched = getItem(db, note.id);
      expect(fetched!.linked_todo_count).toBe(0);
    });

    it("linked_todo_count excludes archived todos", () => {
      const note = createItem(db, { title: "My note", type: "note" });
      createItem(db, { title: "Active todo", type: "todo", linked_note_id: note.id });
      createItem(db, { title: "Archived todo", type: "todo", status: "archived", linked_note_id: note.id });
      const fetched = getItem(db, note.id);
      expect(fetched!.linked_todo_count).toBe(1);
    });

    it("linked_todo_count is 0 for todo items", () => {
      const todo = createItem(db, { title: "A todo", type: "todo" });
      const fetched = getItem(db, todo.id);
      expect(fetched!.linked_todo_count).toBe(0);
    });

    it("listItems returns linked_todo_count for notes", () => {
      const note1 = createItem(db, { title: "Note with todos", type: "note" });
      createItem(db, { title: "Note without todos", type: "note" });
      createItem(db, { title: "Todo 1", type: "todo", linked_note_id: note1.id });
      createItem(db, { title: "Todo 2", type: "todo", linked_note_id: note1.id });
      const result = listItems(db, { type: "note" });
      const withTodos = result.items.find((i) => i.title === "Note with todos");
      const withoutTodos = result.items.find((i) => i.title === "Note without todos");
      expect(withTodos!.linked_todo_count).toBe(2);
      expect(withoutTodos!.linked_todo_count).toBe(0);
    });
  });

  describe("scratch field clearing", () => {
    it("creates scratch item without tags/priority/due/aliases/linked_note_id", () => {
      const item = createItem(db, {
        title: "temp note",
        type: "scratch",
        tags: ["should-be-ignored"],
        priority: "high",
        due: "2026-03-01",
        aliases: ["alias1"],
        linked_note_id: "some-uuid",
      });
      expect(item.type).toBe("scratch");
      expect(item.status).toBe("draft");
      expect(item.tags).toBe("[]");
      expect(item.priority).toBeNull();
      expect(item.due).toBeNull();
      expect(item.aliases).toBe("[]");
      expect(item.linked_note_id).toBeNull();
    });

    it("clears tags/priority/due/aliases when converting to scratch", () => {
      const note = createItem(db, { title: "note", type: "note", tags: ["a"], priority: "high" });
      const updated = updateItem(db, note.id, { type: "scratch" });
      expect(updated!.type).toBe("scratch");
      expect(updated!.status).toBe("draft");
      expect(updated!.tags).toBe("[]");
      expect(updated!.priority).toBeNull();
      expect(updated!.due).toBeNull();
      expect(updated!.aliases).toBe("[]");
      expect(updated!.linked_note_id).toBeNull();
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

  describe("share_visibility resolution", () => {
    function insertShare(itemId: string, visibility: "unlisted" | "public" = "unlisted") {
      const id = crypto.randomUUID();
      const token = crypto.randomUUID().slice(0, 12);
      const now = new Date().toISOString();
      sqlite.prepare(
        "INSERT INTO share_tokens (id, item_id, token, visibility, created) VALUES (?, ?, ?, ?, ?)",
      ).run(id, itemId, token, visibility, now);
    }

    it("getItem returns null share_visibility when no shares", () => {
      const item = createItem(db, { title: "No shares", type: "note" });
      const fetched = getItem(db, item.id);
      expect(fetched!.share_visibility).toBeNull();
    });

    it("getItem returns 'unlisted' when only unlisted shares exist", () => {
      const item = createItem(db, { title: "Unlisted share", type: "note" });
      insertShare(item.id, "unlisted");
      const fetched = getItem(db, item.id);
      expect(fetched!.share_visibility).toBe("unlisted");
    });

    it("getItem returns 'public' when a public share exists", () => {
      const item = createItem(db, { title: "Public share", type: "note" });
      insertShare(item.id, "public");
      const fetched = getItem(db, item.id);
      expect(fetched!.share_visibility).toBe("public");
    });

    it("getItem returns 'public' when both unlisted and public shares exist (public wins)", () => {
      const item = createItem(db, { title: "Mixed shares", type: "note" });
      insertShare(item.id, "unlisted");
      insertShare(item.id, "public");
      const fetched = getItem(db, item.id);
      expect(fetched!.share_visibility).toBe("public");
    });

    it("listItems includes share_visibility for items", () => {
      const shared = createItem(db, { title: "Shared note", type: "note" });
      createItem(db, { title: "Unshared note", type: "note" });
      insertShare(shared.id, "unlisted");
      const result = listItems(db, { type: "note" });
      const sharedItem = result.items.find((i) => i.title === "Shared note");
      const unsharedItem = result.items.find((i) => i.title === "Unshared note");
      expect(sharedItem!.share_visibility).toBe("unlisted");
      expect(unsharedItem!.share_visibility).toBeNull();
    });

    it("listItems with tag filter includes share_visibility", () => {
      const item = createItem(db, { title: "Tagged shared", type: "note", tags: ["test-tag"] });
      insertShare(item.id, "public");
      const result = listItems(db, { tag: "test-tag" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.share_visibility).toBe("public");
    });

    it("share_visibility works for todo items", () => {
      const todo = createItem(db, { title: "Shared todo", type: "todo" });
      insertShare(todo.id, "unlisted");
      const fetched = getItem(db, todo.id);
      expect(fetched!.share_visibility).toBe("unlisted");
    });
  });
});
