import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Database from "better-sqlite3";
import {
  createShareToken,
  getShareByToken,
  listShares,
  listPublicShares,
  revokeShare,
  getSharesByItemId,
} from "../shares.js";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

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
      modified TEXT NOT NULL,
      FOREIGN KEY (linked_note_id) REFERENCES items(id) ON DELETE SET NULL
    );

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

  return sqlite;
}

function insertNote(
  sqlite: Database.Database,
  overrides: Partial<{
    id: string;
    type: string;
    title: string;
    content: string;
    status: string;
    tags: string;
    aliases: string;
  }> = {},
) {
  const id = overrides.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO items (id, type, title, content, status, tags, origin, aliases, created, modified)
       VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
    )
    .run(
      id,
      overrides.type ?? "note",
      overrides.title ?? "Test note",
      overrides.content ?? "Some content",
      overrides.status ?? "fleeting",
      overrides.tags ?? "[]",
      overrides.aliases ?? "[]",
      now,
      now,
    );
  return id;
}

describe("Share Tokens", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = createTestDb();
  });

  afterAll(() => {
    sqlite?.close();
  });

  describe("createShareToken", () => {
    it("creates a share token for a note", () => {
      const itemId = insertNote(sqlite, { title: "My note" });
      const share = createShareToken(sqlite, itemId);
      expect(share).not.toBeNull();
      expect(share!.item_id).toBe(itemId);
      expect(share!.visibility).toBe("unlisted");
      expect(share!.token).toBeTruthy();
      expect(share!.id).toBeTruthy();
      expect(share!.created).toBeTruthy();
    });

    it("generates a 12-char base64url token", () => {
      const itemId = insertNote(sqlite);
      const share = createShareToken(sqlite, itemId);
      expect(share!.token).toHaveLength(12);
      // base64url charset: A-Z, a-z, 0-9, -, _
      expect(share!.token).toMatch(/^[A-Za-z0-9_-]{12}$/);
    });

    it("creates with explicit visibility", () => {
      const itemId = insertNote(sqlite);
      const share = createShareToken(sqlite, itemId, "public");
      expect(share!.visibility).toBe("public");
    });

    it("returns null when item does not exist", () => {
      const share = createShareToken(sqlite, "non-existent-id");
      expect(share).toBeNull();
    });

    it("returns null for non-note items (todo)", () => {
      const itemId = insertNote(sqlite, { type: "todo", status: "active" });
      const share = createShareToken(sqlite, itemId);
      expect(share).toBeNull();
    });

    it("returns null for non-note items (scratch)", () => {
      const itemId = insertNote(sqlite, { type: "scratch", status: "draft" });
      const share = createShareToken(sqlite, itemId);
      expect(share).toBeNull();
    });

    it("can create multiple shares for the same item", () => {
      const itemId = insertNote(sqlite);
      const share1 = createShareToken(sqlite, itemId);
      const share2 = createShareToken(sqlite, itemId, "public");
      expect(share1!.id).not.toBe(share2!.id);
      expect(share1!.token).not.toBe(share2!.token);
    });
  });

  describe("getShareByToken", () => {
    it("returns share with item content", () => {
      const itemId = insertNote(sqlite, {
        title: "Shared note",
        content: "Hello world",
        tags: '["test"]',
        aliases: '["alias1"]',
      });
      const share = createShareToken(sqlite, itemId);
      const result = getShareByToken(sqlite, share!.token);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(share!.id);
      expect(result!.token).toBe(share!.token);
      expect(result!.item_title).toBe("Shared note");
      expect(result!.item_content).toBe("Hello world");
      expect(result!.item_type).toBe("note");
      expect(result!.item_tags).toBe('["test"]');
      expect(result!.item_aliases).toBe('["alias1"]');
    });

    it("returns null for non-existent token", () => {
      const result = getShareByToken(sqlite, "non-existent");
      expect(result).toBeNull();
    });
  });

  describe("listShares", () => {
    it("returns all shares with item titles", () => {
      const id1 = insertNote(sqlite, { title: "Note 1" });
      const id2 = insertNote(sqlite, { title: "Note 2" });
      createShareToken(sqlite, id1);
      createShareToken(sqlite, id2, "public");
      const shares = listShares(sqlite);
      expect(shares).toHaveLength(2);
      const titles = shares.map((s) => s.item_title).sort();
      expect(titles).toEqual(["Note 1", "Note 2"]);
    });

    it("returns empty array when no shares exist", () => {
      const shares = listShares(sqlite);
      expect(shares).toEqual([]);
    });

    it("returns shares in newest-first order", () => {
      const id1 = insertNote(sqlite, { title: "First" });
      const id2 = insertNote(sqlite, { title: "Second" });
      createShareToken(sqlite, id1);
      // Ensure different timestamp
      createShareToken(sqlite, id2);
      const shares = listShares(sqlite);
      // Most recent should be first (desc order)
      expect(shares).toHaveLength(2);
    });
  });

  describe("listPublicShares", () => {
    it("returns only public shares", () => {
      const id1 = insertNote(sqlite, { title: "Unlisted note" });
      const id2 = insertNote(sqlite, { title: "Public note" });
      createShareToken(sqlite, id1, "unlisted");
      createShareToken(sqlite, id2, "public");
      const shares = listPublicShares(sqlite);
      expect(shares).toHaveLength(1);
      expect(shares[0]!.item_title).toBe("Public note");
      expect(shares[0]!.visibility).toBe("public");
    });

    it("returns empty array when no public shares exist", () => {
      const id = insertNote(sqlite);
      createShareToken(sqlite, id, "unlisted");
      const shares = listPublicShares(sqlite);
      expect(shares).toEqual([]);
    });
  });

  describe("revokeShare", () => {
    it("deletes a share and returns true", () => {
      const itemId = insertNote(sqlite);
      const share = createShareToken(sqlite, itemId);
      const result = revokeShare(sqlite, share!.id);
      expect(result).toBe(true);
      // Verify it's gone
      const found = getShareByToken(sqlite, share!.token);
      expect(found).toBeNull();
    });

    it("returns false for non-existent share", () => {
      const result = revokeShare(sqlite, "non-existent-id");
      expect(result).toBe(false);
    });
  });

  describe("getSharesByItemId", () => {
    it("returns all shares for an item", () => {
      const itemId = insertNote(sqlite);
      createShareToken(sqlite, itemId, "unlisted");
      createShareToken(sqlite, itemId, "public");
      const shares = getSharesByItemId(sqlite, itemId);
      expect(shares).toHaveLength(2);
      expect(shares.every((s) => s.item_id === itemId)).toBe(true);
    });

    it("returns empty array when item has no shares", () => {
      const itemId = insertNote(sqlite);
      const shares = getSharesByItemId(sqlite, itemId);
      expect(shares).toEqual([]);
    });

    it("returns empty array for non-existent item", () => {
      const shares = getSharesByItemId(sqlite, "non-existent");
      expect(shares).toEqual([]);
    });
  });

  describe("CASCADE delete", () => {
    it("deletes share tokens when parent item is deleted", () => {
      const itemId = insertNote(sqlite);
      const share = createShareToken(sqlite, itemId);
      expect(share).not.toBeNull();

      // Delete the item
      sqlite.prepare("DELETE FROM items WHERE id = ?").run(itemId);

      // Share should be gone
      const found = getShareByToken(sqlite, share!.token);
      expect(found).toBeNull();

      const byItem = getSharesByItemId(sqlite, itemId);
      expect(byItem).toEqual([]);
    });

    it("only deletes shares for the deleted item, not others", () => {
      const id1 = insertNote(sqlite, { title: "Note 1" });
      const id2 = insertNote(sqlite, { title: "Note 2" });
      createShareToken(sqlite, id1);
      const share2 = createShareToken(sqlite, id2);

      // Delete only the first item
      sqlite.prepare("DELETE FROM items WHERE id = ?").run(id1);

      // share2 should still exist
      const found = getShareByToken(sqlite, share2!.token);
      expect(found).not.toBeNull();
      expect(found!.item_title).toBe("Note 2");

      // All shares list should have 1
      const all = listShares(sqlite);
      expect(all).toHaveLength(1);
    });
  });
});
