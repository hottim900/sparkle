import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb } from "../../test-utils.js";
import {
  createCategory,
  getCategory,
  listCategories,
  updateCategory,
  deleteCategory,
  reorderCategories,
} from "../categories.js";
import { createCategorySchema } from "../../schemas/categories.js";
import { createItem } from "../items.js";

describe("Categories", () => {
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

  describe("createCategory", () => {
    it("creates with name, returns category with id/timestamps", () => {
      const cat = createCategory(db, { name: "Work" });
      expect(cat.id).toBeTruthy();
      expect(cat.name).toBe("Work");
      expect(cat.color).toBeNull();
      expect(cat.sort_order).toBe(0);
      expect(cat.created).toBeTruthy();
      expect(cat.modified).toBeTruthy();
    });

    it("auto-increments sort_order", () => {
      const cat1 = createCategory(db, { name: "First" });
      const cat2 = createCategory(db, { name: "Second" });
      const cat3 = createCategory(db, { name: "Third" });
      expect(cat1.sort_order).toBe(0);
      expect(cat2.sort_order).toBe(1);
      expect(cat3.sort_order).toBe(2);
    });

    it("rejects duplicate name", () => {
      createCategory(db, { name: "Work" });
      expect(() => createCategory(db, { name: "Work" })).toThrow("UNIQUE constraint failed");
    });

    it("creates with color", () => {
      const cat = createCategory(db, { name: "Personal", color: "#ff0000" });
      expect(cat.color).toBe("#ff0000");
    });
  });

  describe("createCategorySchema (Zod)", () => {
    it("rejects empty name", () => {
      const result = createCategorySchema.safeParse({ name: "" });
      expect(result.success).toBe(false);
    });

    it("accepts valid input", () => {
      const result = createCategorySchema.safeParse({ name: "Work" });
      expect(result.success).toBe(true);
    });

    it("defaults color to null", () => {
      const result = createCategorySchema.safeParse({ name: "Work" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.color).toBeNull();
      }
    });
  });

  describe("getCategory", () => {
    it("returns category by id", () => {
      const created = createCategory(db, { name: "Work" });
      const found = getCategory(db, created.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe("Work");
    });

    it("returns null for non-existent id", () => {
      const found = getCategory(db, "non-existent-id");
      expect(found).toBeNull();
    });
  });

  describe("listCategories", () => {
    it("returns sorted by sort_order", () => {
      createCategory(db, { name: "C" });
      createCategory(db, { name: "A" });
      createCategory(db, { name: "B" });
      const list = listCategories(db);
      expect(list).toHaveLength(3);
      expect(list[0]!.name).toBe("C");
      expect(list[1]!.name).toBe("A");
      expect(list[2]!.name).toBe("B");
    });

    it("returns empty array when none exist", () => {
      const list = listCategories(db);
      expect(list).toEqual([]);
    });
  });

  describe("updateCategory", () => {
    it("updates name and modified timestamp", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const cat = createCategory(db, { name: "Old" });
      expect(cat.modified).toBe("2026-01-01T00:00:00.000Z");

      vi.setSystemTime(new Date("2026-01-01T01:00:00Z"));
      const updated = updateCategory(db, cat.id, { name: "New" });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("New");
      expect(updated!.modified).toBe("2026-01-01T01:00:00.000Z");
      vi.useRealTimers();
    });

    it("updates color", () => {
      const cat = createCategory(db, { name: "Work" });
      const updated = updateCategory(db, cat.id, { color: "#00ff00" });
      expect(updated).not.toBeNull();
      expect(updated!.color).toBe("#00ff00");
    });

    it("returns null for non-existent id", () => {
      const result = updateCategory(db, "non-existent-id", { name: "Nope" });
      expect(result).toBeNull();
    });

    it("rejects duplicate name on rename", () => {
      createCategory(db, { name: "Work" });
      const cat2 = createCategory(db, { name: "Personal" });
      expect(() => updateCategory(db, cat2.id, { name: "Work" })).toThrow(
        "UNIQUE constraint failed",
      );
    });
  });

  describe("deleteCategory", () => {
    it("deletes and returns true", () => {
      const cat = createCategory(db, { name: "ToDelete" });
      const result = deleteCategory(db, cat.id);
      expect(result).toBe(true);
      expect(getCategory(db, cat.id)).toBeNull();
    });

    it("returns false for non-existent id", () => {
      const result = deleteCategory(db, "non-existent-id");
      expect(result).toBe(false);
    });

    it("items with category_id get set to NULL (FK ON DELETE SET NULL)", () => {
      const cat = createCategory(db, { name: "Work" });
      const item = createItem(db, { title: "Test item" });

      // Manually set category_id on the item
      sqlite.prepare("UPDATE items SET category_id = ? WHERE id = ?").run(cat.id, item.id);

      // Verify it's set
      const before = sqlite.prepare("SELECT category_id FROM items WHERE id = ?").get(item.id) as {
        category_id: string | null;
      };
      expect(before.category_id).toBe(cat.id);

      // Delete category
      deleteCategory(db, cat.id);

      // Item's category_id should be NULL
      const after = sqlite.prepare("SELECT category_id FROM items WHERE id = ?").get(item.id) as {
        category_id: string | null;
      };
      expect(after.category_id).toBeNull();
    });
  });

  describe("reorderCategories", () => {
    it("updates sort_order for multiple categories", () => {
      const cat1 = createCategory(db, { name: "A" });
      const cat2 = createCategory(db, { name: "B" });
      const cat3 = createCategory(db, { name: "C" });

      // Reverse the order
      reorderCategories(db, [
        { id: cat3.id, sort_order: 0 },
        { id: cat2.id, sort_order: 1 },
        { id: cat1.id, sort_order: 2 },
      ]);

      const list = listCategories(db);
      expect(list[0]!.name).toBe("C");
      expect(list[0]!.sort_order).toBe(0);
      expect(list[1]!.name).toBe("B");
      expect(list[1]!.sort_order).toBe(1);
      expect(list[2]!.name).toBe("A");
      expect(list[2]!.sort_order).toBe(2);
    });
  });
});
