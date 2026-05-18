import { describe, it, expect } from "vitest";
import { createTestDb, insertActiveRow } from "../../test-utils.js";
import { createItem, updateItem } from "../items.js";

describe("write-hook integration", () => {
  it("createItem marks the new row reindex_dirty=1", () => {
    const { db, sqlite } = createTestDb();
    const created = createItem(db, { title: "Hello", content: "[[Target]]" });
    const row = sqlite
      .prepare("SELECT reindex_dirty FROM items_active WHERE id = ?")
      .get(created.id) as { reindex_dirty: number };
    expect(row.reindex_dirty).toBe(1);
  });

  it("updateItem with content change marks dirty", () => {
    const { db, sqlite } = createTestDb();
    const id = insertActiveRow(sqlite, { title: "X", content: "before" });
    sqlite.prepare("UPDATE items_active SET reindex_dirty = 0 WHERE id = ?").run(id);

    updateItem(db, id, { content: "after [[Target]]" });

    const row = sqlite.prepare("SELECT reindex_dirty FROM items_active WHERE id = ?").get(id) as {
      reindex_dirty: number;
    };
    expect(row.reindex_dirty).toBe(1);
  });

  it("updateItem with title-only change marks dirty (title affects resolver)", () => {
    const { db, sqlite } = createTestDb();
    const id = insertActiveRow(sqlite, { title: "OldTitle", content: "body" });
    sqlite.prepare("UPDATE items_active SET reindex_dirty = 0 WHERE id = ?").run(id);

    updateItem(db, id, { title: "NewTitle" });

    const row = sqlite.prepare("SELECT reindex_dirty FROM items_active WHERE id = ?").get(id) as {
      reindex_dirty: number;
    };
    expect(row.reindex_dirty).toBe(1);
  });

  it("updateItem with neither content nor title change does NOT mark dirty", () => {
    const { db, sqlite } = createTestDb();
    const id = insertActiveRow(sqlite, { title: "X", content: "body" });
    sqlite.prepare("UPDATE items_active SET reindex_dirty = 0 WHERE id = ?").run(id);

    updateItem(db, id, { status: "developing" });

    const row = sqlite.prepare("SELECT reindex_dirty FROM items_active WHERE id = ?").get(id) as {
      reindex_dirty: number;
    };
    expect(row.reindex_dirty).toBe(0);
  });

  it("updateItem with priority/category change does NOT mark dirty", () => {
    const { db, sqlite } = createTestDb();
    const id = insertActiveRow(sqlite, { title: "X", content: "body", type: "todo" });
    sqlite.prepare("UPDATE items_active SET reindex_dirty = 0 WHERE id = ?").run(id);

    updateItem(db, id, { priority: "high" });

    const row = sqlite.prepare("SELECT reindex_dirty FROM items_active WHERE id = ?").get(id) as {
      reindex_dirty: number;
    };
    expect(row.reindex_dirty).toBe(0);
  });
});
