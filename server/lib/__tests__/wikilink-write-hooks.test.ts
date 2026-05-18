import { describe, it, expect } from "vitest";
import { createTestDb, insertActiveRow } from "../../test-utils.js";
import { createItem, updateItem } from "../items.js";
import { TitleCollisionError } from "../wikilink.js";

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

describe("title uniqueness enforcement (Pre-PR0e + ENG-7)", () => {
  it("createItem throws TitleCollisionError on case-insensitive duplicate", () => {
    const { db, sqlite } = createTestDb();
    insertActiveRow(sqlite, { title: "Taken" });

    expect(() => createItem(db, { title: "TAKEN" })).toThrow(TitleCollisionError);
    expect(() => createItem(db, { title: "  taken  " })).toThrow(TitleCollisionError);
  });

  it("createItem allows duplicate when title is on the allowlist (未命名)", () => {
    const { db, sqlite } = createTestDb();
    insertActiveRow(sqlite, { title: "未命名" });

    expect(() => createItem(db, { title: "未命名" })).not.toThrow();
    const count = sqlite
      .prepare("SELECT COUNT(*) as n FROM items_active WHERE title = '未命名'")
      .get() as { n: number };
    expect(count.n).toBe(2);
  });

  it("createItem rejects NFC-equivalent duplicates", () => {
    const { db, sqlite } = createTestDb();
    // Decomposed form (e + COMBINING ACUTE ACCENT)
    const decomposed = "Café";
    insertActiveRow(sqlite, { title: decomposed.normalize("NFC") });

    // Composed form should be rejected — both normalize to the same NFC value
    expect(() => createItem(db, { title: "Café" })).toThrow(TitleCollisionError);
  });

  it("updateItem throws when renaming to an existing title", () => {
    const { db, sqlite } = createTestDb();
    insertActiveRow(sqlite, { title: "Existing" });
    const otherId = insertActiveRow(sqlite, { title: "Other" });

    expect(() => updateItem(db, otherId, { title: "Existing" })).toThrow(TitleCollisionError);
  });

  it("updateItem allows self-rename (no-op title set passes exceptId check)", () => {
    const { db, sqlite } = createTestDb();
    const id = insertActiveRow(sqlite, { title: "Same" });

    // Setting to NFC-equivalent of own title should not throw; the engine
    // treats it as a no-op rename because normalizedNew === existing.title.
    expect(() => updateItem(db, id, { title: "Same" })).not.toThrow();
    // Renaming case-only (same NFC after lowercase) should also succeed —
    // exceptId lets the row claim its own normalized form.
    expect(() => updateItem(db, id, { title: "SAME" })).not.toThrow();
  });

  it("updateItem rejects title change that would collide with another row", () => {
    const { db, sqlite } = createTestDb();
    insertActiveRow(sqlite, { title: "Apple" });
    const bananaId = insertActiveRow(sqlite, { title: "Banana" });

    expect(() => updateItem(db, bananaId, { title: "apple" })).toThrow(TitleCollisionError);
    // Banana row's title must NOT have changed
    const row = sqlite.prepare("SELECT title FROM items_active WHERE id = ?").get(bananaId) as {
      title: string;
    };
    expect(row.title).toBe("Banana");
  });

  it("ENG-7: title check + insert is atomic under BEGIN IMMEDIATE (serial)", () => {
    const { db, sqlite } = createTestDb();
    // First insert succeeds, second insert with same title throws — both
    // requests serialize through the IMMEDIATE lock. Without it, both could
    // observe "available" and both would commit.
    createItem(db, { title: "OnlyOne" });
    expect(() => createItem(db, { title: "OnlyOne" })).toThrow(TitleCollisionError);

    const count = sqlite
      .prepare("SELECT COUNT(*) as n FROM items_active WHERE LOWER(TRIM(title)) = 'onlyone'")
      .get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("updateItem with empty→non-empty title is treated as first-time set, not rename", () => {
    const { db, sqlite } = createTestDb();
    const id = insertActiveRow(sqlite, { title: "" });

    expect(() => updateItem(db, id, { title: "FirstTitle" })).not.toThrow();
    const row = sqlite.prepare("SELECT title FROM items_active WHERE id = ?").get(id) as {
      title: string;
    };
    expect(row.title).toBe("FirstTitle");

    // Also rename_history should NOT have an entry — first-title-set is not a rename.
    const history = sqlite
      .prepare("SELECT COUNT(*) as n FROM rename_history WHERE target_id = ?")
      .get(id) as { n: number };
    expect(history.n).toBe(0);
  });
});
