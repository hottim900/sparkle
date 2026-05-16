import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb, insertActiveRow, insertVaultRow } from "../../test-utils.js";
import {
  createItem,
  getItem,
  getItemForLookup,
  listItems,
  updateItem,
  deleteItem,
  searchItems,
  getAllTags,
} from "../items.js";

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
      expect(result.items.map((i: { title: string }) => i.title).sort()).toEqual([
        "Developing",
        "Fleeting",
      ]);
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

    it("sorts by priority with tag filter", () => {
      createItem(db, { title: "Low", tags: ["work"], priority: "low" });
      createItem(db, { title: "High", tags: ["work"], priority: "high" });
      createItem(db, { title: "Mid", tags: ["work"], priority: "medium" });
      const result = listItems(db, { tag: "work", sort: "priority", order: "desc" });
      expect(result.items.map((i) => i.title)).toEqual(["Mid", "Low", "High"]);
    });

    it("sorts by created ascending with tag filter", () => {
      const { v4: uuidv4 } = require("uuid");
      for (const [title, ts] of [
        ["Third", "2026-01-03T00:00:00.000Z"],
        ["First", "2026-01-01T00:00:00.000Z"],
        ["Second", "2026-01-02T00:00:00.000Z"],
      ] as const) {
        sqlite
          .prepare(
            "INSERT INTO items_active (id, title, type, status, tags, origin, aliases, created, modified) VALUES (?, ?, 'note', 'fleeting', '[\"dev\"]', '', '[]', ?, ?)",
          )
          .run(uuidv4(), title, ts, ts);
      }
      const result = listItems(db, { tag: "dev", sort: "created", order: "asc" });
      expect(result.items[0]!.title).toBe("First");
      expect(result.items[1]!.title).toBe("Second");
      expect(result.items[2]!.title).toBe("Third");
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
        sqlite
          .prepare(
            "INSERT INTO items_active (id, title, type, status, tags, origin, aliases, created, modified) VALUES (?, ?, 'note', 'fleeting', '[]', '', '[]', ?, ?)",
          )
          .run(uuidv4(), title, created, modified);
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
        sqlite
          .prepare(
            "INSERT INTO items_active (id, title, type, status, tags, origin, aliases, created, modified) VALUES (?, ?, 'note', 'fleeting', '[]', '', '[]', ?, ?)",
          )
          .run(uuidv4(), title, created, modified);
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
        sqlite
          .prepare(
            "INSERT INTO items_active (id, title, type, status, tags, origin, aliases, created, modified) VALUES (?, ?, 'note', 'fleeting', '[]', '', '[]', ?, ?)",
          )
          .run(uuidv4(), title, ts, ts);
      }
      const result = listItems(db);
      expect(result.items[0]!.title).toBe("Third");
      expect(result.items[2]!.title).toBe("First");
    });

    describe("v1.4.0 cross-table modes", () => {
      const { v4: uuidv4 } = require("uuid");

      // Local shim (positional args for concise `it.each`-style tables below).
      // Named distinctly from the shared insertVaultRow in test-utils to avoid
      // shadowing confusion.
      function insertVaultAtDate(
        title: string,
        exportedAt: string,
        opts: { tags?: string[]; category_id?: string | null; is_private?: 0 | 1 } = {},
      ): string {
        const id = uuidv4();
        sqlite
          .prepare(
            `INSERT INTO items_vault (id, title, tags, aliases, origin, exported_at, created, is_private, content_snippet, category_id)
             VALUES (?, ?, ?, '[]', '', ?, ?, ?, '', ?)`,
          )
          .run(
            id,
            title,
            JSON.stringify(opts.tags ?? []),
            exportedAt,
            exportedAt,
            opts.is_private ?? 0,
            opts.category_id ?? null,
          );
        return id;
      }

      it("status='exported' routes to items_vault only", () => {
        createItem(db, { title: "Active note" });
        insertVaultAtDate("Vault note", "2026-04-01T00:00:00.000Z");
        const result = listItems(db, { status: "exported" });
        expect(result.items).toHaveLength(1);
        expect(result.items[0]!.title).toBe("Vault note");
        expect(result.items[0]!.origin).toBe("vault");
        expect(result.total).toBe(1);
      });

      it("include_vault='true' merges items_active + items_vault", () => {
        createItem(db, { title: "Active" });
        insertVaultAtDate("Vault", "2026-04-01T00:00:00.000Z");
        const result = listItems(db, { include_vault: "true" });
        const titles = result.items.map((i) => i.title).sort();
        expect(titles).toEqual(["Active", "Vault"]);
        expect(result.total).toBe(2);
      });

      it("include_vault='true' sorts merged rows by created desc", () => {
        sqlite
          .prepare(
            "INSERT INTO items_active (id, title, type, status, tags, origin, aliases, created, modified) VALUES (?, ?, 'note', 'fleeting', '[]', '', '[]', ?, ?)",
          )
          .run(uuidv4(), "Active-2026-02", "2026-02-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z");
        insertVaultAtDate("Vault-2026-04", "2026-04-01T00:00:00.000Z");
        insertVaultAtDate("Vault-2026-01", "2026-01-15T00:00:00.000Z");
        const result = listItems(db, { include_vault: "true", sort: "created", order: "desc" });
        expect(result.items.map((i) => i.title)).toEqual([
          "Vault-2026-04",
          "Active-2026-02",
          "Vault-2026-01",
        ]);
      });

      it("include_vault='true' with category_id filters both tables", () => {
        const catId = uuidv4();
        sqlite
          .prepare(
            "INSERT INTO categories (id, name, sort_order, created, modified) VALUES (?, ?, 0, ?, ?)",
          )
          .run(catId, "Work", new Date().toISOString(), new Date().toISOString());
        createItem(db, { title: "Active-cat", category_id: catId });
        createItem(db, { title: "Active-other" });
        insertVaultAtDate("Vault-cat", "2026-04-01T00:00:00.000Z", { category_id: catId });
        insertVaultAtDate("Vault-other", "2026-04-02T00:00:00.000Z");
        const result = listItems(db, { include_vault: "true", category_id: catId });
        const titles = result.items.map((i) => i.title).sort();
        expect(titles).toEqual(["Active-cat", "Vault-cat"]);
      });

      it("include_vault='true' applies tag filter to vault rows", () => {
        createItem(db, { title: "Active-tagged", tags: ["work"] });
        createItem(db, { title: "Active-untagged" });
        insertVaultAtDate("Vault-tagged", "2026-04-01T00:00:00.000Z", { tags: ["work"] });
        insertVaultAtDate("Vault-untagged", "2026-04-02T00:00:00.000Z");
        const result = listItems(db, { include_vault: "true", tag: "work" });
        const titles = result.items.map((i) => i.title).sort();
        expect(titles).toEqual(["Active-tagged", "Vault-tagged"]);
      });

      it("include_vault='true' with type='todo' skips vault (vault has no todos)", () => {
        createItem(db, { title: "A todo", type: "todo" });
        insertVaultAtDate("Vault-note", "2026-04-01T00:00:00.000Z");
        const result = listItems(db, { include_vault: "true", type: "todo" });
        expect(result.items).toHaveLength(1);
        expect(result.items[0]!.title).toBe("A todo");
      });

      it("include_vault='true' paginates merged window", () => {
        for (let i = 0; i < 3; i++) {
          sqlite
            .prepare(
              "INSERT INTO items_active (id, title, type, status, tags, origin, aliases, created, modified) VALUES (?, ?, 'note', 'fleeting', '[]', '', '[]', ?, ?)",
            )
            .run(
              uuidv4(),
              `A-${i}`,
              `2026-0${i + 1}-01T00:00:00.000Z`,
              `2026-0${i + 1}-01T00:00:00.000Z`,
            );
        }
        for (let i = 0; i < 2; i++) {
          insertVaultAtDate(`V-${i}`, `2026-0${4 + i}-01T00:00:00.000Z`);
        }
        const page1 = listItems(db, { include_vault: "true", limit: 2, offset: 0 });
        const page2 = listItems(db, { include_vault: "true", limit: 2, offset: 2 });
        expect(page1.items).toHaveLength(2);
        expect(page2.items).toHaveLength(2);
        expect(page1.total).toBe(5);
        expect(page2.total).toBe(5);
        expect(page1.items[0]!.title).toBe("V-1");
      });
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

    // NOTE: "blocks updates on exported item" tests removed — exported items now
    // live in items_vault and are short-circuited with 409 VAULT_READONLY at the
    // route layer. Guard covered by route-layer tests.
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
      sqlite
        .prepare(
          "INSERT INTO share_tokens (id, item_id, token, visibility, created) VALUES (?, ?, ?, ?, ?)",
        )
        .run(shareId, note.id, token, "public", new Date().toISOString());
      // Create a linked todo
      createItem(db, { title: "Linked todo for search", type: "todo", linked_note_id: note.id });

      const results = searchItems(sqlite, db, "Searchable note for enrichment");
      expect(results).toHaveLength(1);
      expect(results[0]!.share_visibility).toBe("public");
      expect(results[0]!.linked_todo_count).toBe(1);
      expect(results[0]!.linked_note_title).toBeNull();
    });

    describe("id: prefix syntax", () => {
      it("finds an active item by full UUID", () => {
        const note = createItem(db, { title: "Find me by full id" });
        const results = searchItems(sqlite, db, `id:${note.id}`);
        expect(results).toHaveLength(1);
        expect(results[0]!.id).toBe(note.id);
        expect(results[0]!.origin).toBe("active");
      });

      it("finds an active item by short hex prefix (>= 4 chars)", () => {
        const id = "abc12345-1111-4111-8111-111111111111";
        insertActiveRow(sqlite, { id, title: "Short prefix lookup" });
        const results = searchItems(sqlite, db, "id:abc12345");
        expect(results).toHaveLength(1);
        expect(results[0]!.id).toBe(id);
      });

      it("finds a vault item by id (cross-table)", () => {
        const id = "deadbeef-2222-4222-8222-222222222222";
        insertVaultRow(sqlite, { id, title: "Vault exported note" });
        const results = searchItems(sqlite, db, `id:${id}`);
        expect(results).toHaveLength(1);
        expect(results[0]!.id).toBe(id);
        expect(results[0]!.origin).toBe("vault");
        expect(results[0]!.status).toBe("exported");
      });

      it("returns multiple matches when prefix is ambiguous across both tables", () => {
        insertActiveRow(sqlite, {
          id: "cafe1111-3333-4333-8333-333333333333",
          title: "Active ambiguous A",
        });
        insertActiveRow(sqlite, {
          id: "cafe2222-3333-4333-8333-333333333333",
          title: "Active ambiguous B",
        });
        insertVaultRow(sqlite, {
          id: "cafe3333-3333-4333-8333-333333333333",
          title: "Vault ambiguous C",
        });
        const results = searchItems(sqlite, db, "id:cafe");
        expect(results).toHaveLength(3);
        expect(results.map((r) => r.id).sort()).toEqual([
          "cafe1111-3333-4333-8333-333333333333",
          "cafe2222-3333-4333-8333-333333333333",
          "cafe3333-3333-4333-8333-333333333333",
        ]);
      });

      it("returns empty when no item matches the id prefix", () => {
        createItem(db, { title: "Unrelated" });
        const results = searchItems(sqlite, db, "id:00000000");
        expect(results).toHaveLength(0);
      });

      it("does NOT fall back to FTS when id: prefix produces no match", () => {
        // 'meeting' would normally FTS-match this row's title; with id: syntax
        // we want strict ID semantics — no accidental keyword fallback.
        createItem(db, { title: "Meeting notes containing the word meeting" });
        const results = searchItems(sqlite, db, "id:meeting1");
        expect(results).toHaveLength(0);
      });

      it("returns empty for shorter-than-4-char prefix", () => {
        insertActiveRow(sqlite, {
          id: "ab123456-4444-4444-8444-444444444444",
          title: "Has short prefix",
        });
        const results = searchItems(sqlite, db, "id:ab");
        expect(results).toHaveLength(0);
      });

      it("returns empty for non-hex characters after id:", () => {
        createItem(db, { title: "Has id:zzzz in title" });
        const results = searchItems(sqlite, db, "id:zzzzzzzz");
        expect(results).toHaveLength(0);
      });

      it("is case-insensitive on the id: prefix and hex chars", () => {
        const id = "abcdef99-5555-4555-8555-555555555555";
        insertActiveRow(sqlite, { id, title: "Case insensitive" });
        const results = searchItems(sqlite, db, "ID:ABCDEF99");
        expect(results).toHaveLength(1);
        expect(results[0]!.id).toBe(id);
      });

      it("respects privacy filter (excludes private rows by default)", () => {
        const id = "11112222-6666-4666-8666-666666666666";
        insertActiveRow(sqlite, { id, title: "Private", is_private: 1 });
        expect(searchItems(sqlite, db, `id:${id}`)).toHaveLength(0);
        expect(searchItems(sqlite, db, `id:${id}`, 20, true, true)).toHaveLength(1);
      });

      it("includePrivate='only' returns only private rows", () => {
        const pubId = "11110000-9999-4999-8999-999999999999";
        const privId = "11119999-9999-4999-8999-999999999999";
        insertActiveRow(sqlite, { id: pubId, title: "Public match" });
        insertActiveRow(sqlite, { id: privId, title: "Private match", is_private: 1 });
        const results = searchItems(sqlite, db, "id:1111", 20, true, "only");
        expect(results.map((r) => r.id)).toEqual([privId]);
      });

      it("respects limit when ambiguous prefix has many matches", () => {
        for (let i = 0; i < 5; i++) {
          insertActiveRow(sqlite, {
            id: `deadbe${i}f-7777-4777-8777-777777777777`,
            title: `Limit test ${i}`,
          });
        }
        const results = searchItems(sqlite, db, "id:deadbe", 2);
        expect(results).toHaveLength(2);
      });

      it("tolerates whitespace around the id value", () => {
        const note = createItem(db, { title: "Whitespace tolerant" });
        const results = searchItems(sqlite, db, `id:  ${note.id}  `);
        expect(results).toHaveLength(1);
        expect(results[0]!.id).toBe(note.id);
      });

      it("rejects hex+dash mixed short prefix (would never match UUID position)", () => {
        // UUIDs have dashes at fixed positions (8-4-4-4-12); a 'abc-1234' prefix
        // would always produce 0 LIKE matches, so reject it explicitly rather
        // than silently returning empty after a wasted query.
        insertActiveRow(sqlite, {
          id: "abc12345-8888-4888-8888-888888888888",
          title: "No dash prefix",
        });
        expect(searchItems(sqlite, db, "id:abc-1234")).toHaveLength(0);
      });

      it("rejects all-dash prefix", () => {
        expect(searchItems(sqlite, db, "id:----")).toHaveLength(0);
      });
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

    // NOTE: exported-note type-conversion block test removed — covered by
    // route-layer 409 VAULT_READONLY guard in the new schema-split world.

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

    it("ON DELETE SET NULL: deleting linked note nullifies linked_note_id", () => {
      const note = createItem(db, { title: "Will be deleted", type: "note" });
      const todo = createItem(db, {
        title: "Track note",
        type: "todo",
        linked_note_id: note.id,
      });
      expect(todo.linked_note_id).toBe(note.id);
      deleteItem(db, note.id);
      const fetched = getItem(db, todo.id);
      expect(fetched!.linked_note_id).toBeNull();
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
      createItem(db, {
        title: "Archived todo",
        type: "todo",
        status: "archived",
        linked_note_id: note.id,
      });
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

  describe("category_id", () => {
    function insertCategory(name: string): string {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      sqlite
        .prepare(
          "INSERT INTO categories (id, name, sort_order, created, modified) VALUES (?, ?, 0, ?, ?)",
        )
        .run(id, name, now, now);
      return id;
    }

    it("createItem with category_id stores it", () => {
      const catId = insertCategory("Work");
      const item = createItem(db, { title: "Categorized note", category_id: catId });
      expect(item.category_id).toBe(catId);
    });

    it("updateItem with category_id updates it", () => {
      const catId = insertCategory("Personal");
      const item = createItem(db, { title: "Uncategorized" });
      expect(item.category_id).toBeNull();
      const updated = updateItem(db, item.id, { category_id: catId });
      expect(updated!.category_id).toBe(catId);
    });

    it("updateItem can clear category_id", () => {
      const catId = insertCategory("Temp");
      const item = createItem(db, { title: "Will uncategorize", category_id: catId });
      const updated = updateItem(db, item.id, { category_id: null });
      expect(updated!.category_id).toBeNull();
    });

    it("listItems filtered by category_id", () => {
      const catId = insertCategory("Filter Cat");
      createItem(db, { title: "In category", category_id: catId });
      createItem(db, { title: "No category" });
      const result = listItems(db, { category_id: catId });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.title).toBe("In category");
    });

    it("category_name is resolved in getItem response", () => {
      const catId = insertCategory("Resolved Cat");
      const item = createItem(db, { title: "With category", category_id: catId });
      const fetched = getItem(db, item.id);
      expect(fetched!.category_name).toBe("Resolved Cat");
    });

    it("category_name is null when no category_id", () => {
      const item = createItem(db, { title: "No cat" });
      const fetched = getItem(db, item.id);
      expect(fetched!.category_name).toBeNull();
    });

    it("category_id preserved on type conversion to scratch", () => {
      const catId = insertCategory("Keep Me");
      const note = createItem(db, { title: "Note with cat", type: "note", category_id: catId });
      const updated = updateItem(db, note.id, { type: "scratch" });
      expect(updated!.type).toBe("scratch");
      expect(updated!.category_id).toBe(catId);
    });

    it("listItems returns category_name for items", () => {
      const catId = insertCategory("List Cat");
      createItem(db, { title: "Categorized", category_id: catId });
      createItem(db, { title: "Uncategorized" });
      const result = listItems(db);
      const categorized = result.items.find((i) => i.title === "Categorized");
      const uncategorized = result.items.find((i) => i.title === "Uncategorized");
      expect(categorized!.category_name).toBe("List Cat");
      expect(uncategorized!.category_name).toBeNull();
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

  // NOTE: "exported items read-only guard" suite removed. Exported items now
  // live in items_vault (no status='exported' in items_active); read-only
  // enforcement is a 409 VAULT_READONLY short-circuit at the route layer.
  // Replaced by dedicated route-layer tests.

  describe("share_visibility resolution", () => {
    function insertShare(itemId: string, visibility: "unlisted" | "public" = "unlisted") {
      const id = crypto.randomUUID();
      const token = crypto.randomUUID().slice(0, 12);
      const now = new Date().toISOString();
      sqlite
        .prepare(
          "INSERT INTO share_tokens (id, item_id, token, visibility, created) VALUES (?, ?, ?, ?, ?)",
        )
        .run(id, itemId, token, visibility, now);
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

  describe("enrich=false skips enrichment queries", () => {
    it("getItem with enrich=false returns null/0 enrichment fields", () => {
      const item = createItem(db, { title: "Test note" });
      const fetched = getItem(db, item.id, false);
      expect(fetched).not.toBeNull();
      expect(fetched!.title).toBe("Test note");
      expect(fetched!.linked_note_title).toBeNull();
      expect(fetched!.linked_todo_count).toBe(0);
      expect(fetched!.share_visibility).toBeNull();
      expect(fetched!.category_name).toBeNull();
    });

    it("listItems with enrich=false returns null/0 enrichment fields", () => {
      createItem(db, { title: "A", type: "note" });
      createItem(db, { title: "B", type: "todo" });
      const result = listItems(db, {}, false);
      expect(result.items.length).toBe(2);
      for (const item of result.items) {
        expect(item.linked_note_title).toBeNull();
        expect(item.linked_todo_count).toBe(0);
        expect(item.share_visibility).toBeNull();
        expect(item.category_name).toBeNull();
      }
    });

    it("searchItems with enrich=false returns null/0 enrichment fields", () => {
      createItem(db, { title: "Searchable note" });
      const results = searchItems(sqlite, db, "Searchable", 10, false);
      expect(results.length).toBe(1);
      expect(results[0]!.linked_note_title).toBeNull();
      expect(results[0]!.linked_todo_count).toBe(0);
    });
  });

  describe("getItemForLookup — cross-table wikilink resolution", () => {
    // Local shorthand: these tests need explicit ids (to control prefix under
    // test) + is_private toggle; everything else is irrelevant.
    const insertActiveWithId = (id: string, title: string, isPrivate: 0 | 1 = 0): void => {
      insertActiveRow(sqlite, { id, title, is_private: isPrivate });
    };
    const insertVaultWithId = (id: string, title: string, isPrivate: 0 | 1 = 0): void => {
      insertVaultRow(sqlite, { id, title, is_private: isPrivate });
    };

    it("returns origin='active' when prefix matches a unique active row", () => {
      const id = "aaaaaaaa-1234-4567-8abc-def012345678";
      insertActiveWithId(id, "Active-only note");

      const result = getItemForLookup(db, "aaaaaaaa");
      expect(result).toEqual({
        id,
        title: "Active-only note",
        origin: "active",
      });
    });

    it("returns origin='vault' when prefix matches a unique vault row", () => {
      const id = "bbbbbbbb-1234-4567-8abc-def012345678";
      insertVaultWithId(id, "Vault-only note");

      const result = getItemForLookup(db, "bbbbbbbb");
      expect(result).toEqual({
        id,
        title: "Vault-only note",
        origin: "vault",
      });
    });

    it("returns null when prefix collides across active and vault (preserves wikilink text)", () => {
      // Both rows share prefix 'cccccccc' — different full ids.
      const activeId = "cccccccc-1111-4111-8abc-def012345678";
      const vaultId = "cccccccc-2222-4222-8bcd-ef1234567890";
      insertActiveWithId(activeId, "Active C");
      insertVaultWithId(vaultId, "Vault C");

      const result = getItemForLookup(db, "cccccccc");
      expect(result).toBeNull();
    });

    it("returns null when prefix collides within the active table alone", () => {
      // Two active rows with shared prefix — cross-table total is still > 1.
      insertActiveWithId("dddddddd-1111-4111-8abc-def012345678", "A1");
      insertActiveWithId("dddddddd-2222-4222-8bcd-ef1234567890", "A2");

      const result = getItemForLookup(db, "dddddddd");
      expect(result).toBeNull();
    });

    it("returns null on empty db (no match anywhere)", () => {
      const result = getItemForLookup(db, "deadbeef");
      expect(result).toBeNull();
    });

    it("returns null when no row matches the prefix", () => {
      insertActiveWithId("11111111-1111-4111-8abc-def012345678", "Active");
      insertVaultWithId("22222222-2222-4222-8bcd-ef1234567890", "Vault");

      const result = getItemForLookup(db, "99999999");
      expect(result).toBeNull();
    });

    it("returns null when prefix is too short (< 4 chars) — LIKE_SAFE_RE guard", () => {
      // Even if a row would match, the regex must reject short prefixes
      // before any LIKE runs (SQL injection / runaway match guard).
      insertActiveWithId("abc12345-1234-4567-8abc-def012345678", "Short prefix target");

      const result = getItemForLookup(db, "abc");
      expect(result).toBeNull();
    });

    it("returns null when prefix is non-hex and has no matching row", () => {
      // LIKE_SAFE_RE accepts any non-%/_ chars (not hex-only), so "ghij"
      // passes the regex and runs a LIKE query — which finds nothing because
      // all our ids are hex.
      insertActiveWithId("11111111-1111-4111-8abc-def012345678", "Hex row");

      const result = getItemForLookup(db, "ghij");
      expect(result).toBeNull();
    });

    it("matches on full UUID in items_active → origin='active'", () => {
      const id = "ffffffff-1234-4567-8abc-def012345678";
      insertActiveWithId(id, "Full UUID active");

      const result = getItemForLookup(db, id);
      expect(result).toEqual({ id, title: "Full UUID active", origin: "active" });
    });

    it("matches on full UUID in items_vault → origin='vault'", () => {
      const id = "eeeeeeee-1234-4567-8abc-def012345678";
      insertVaultWithId(id, "Full UUID vault");

      const result = getItemForLookup(db, id);
      expect(result).toEqual({ id, title: "Full UUID vault", origin: "vault" });
    });

    it("skips private rows in active (is_private=1 treated as miss)", () => {
      // A private active row and a public vault row with matching prefix —
      // since private is filtered out, only the vault row survives → origin='vault'.
      insertActiveWithId("77777777-1111-4111-8abc-def012345678", "Private active", 1);
      const vaultId = "77777777-2222-4222-8bcd-ef1234567890";
      insertVaultWithId(vaultId, "Public vault");

      const result = getItemForLookup(db, "77777777");
      expect(result).toEqual({ id: vaultId, title: "Public vault", origin: "vault" });
    });

    it("skips private rows in vault (is_private=1 treated as miss)", () => {
      // Public active + private vault sharing prefix → only active matches.
      const activeId = "88888888-1111-4111-8abc-def012345678";
      insertActiveWithId(activeId, "Public active");
      insertVaultWithId("88888888-2222-4222-8bcd-ef1234567890", "Private vault", 1);

      const result = getItemForLookup(db, "88888888");
      expect(result).toEqual({ id: activeId, title: "Public active", origin: "active" });
    });
  });
});
