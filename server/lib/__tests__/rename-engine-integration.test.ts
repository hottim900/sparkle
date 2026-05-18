import { describe, it, expect } from "vitest";
import { updateItem } from "../items.js";
import { reindexItemReferences } from "../wikilink.js";
import { createTestDb, insertActiveRow } from "../../test-utils.js";

describe("updateItem auto-triggers rename engine", () => {
  it("title change rewrites all citing sources", () => {
    const { db, sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Original" });
    const sourceId = insertActiveRow(sqlite, { content: "see [[Original]] now" });
    reindexItemReferences(sqlite, sourceId);

    updateItem(db, targetId, { title: "Renamed" });

    const src = sqlite.prepare("SELECT content FROM items_active WHERE id = ?").get(sourceId) as {
      content: string;
    };
    expect(src.content).toBe("see [[Renamed]] now");

    const tgt = sqlite.prepare("SELECT title FROM items_active WHERE id = ?").get(targetId) as {
      title: string;
    };
    expect(tgt.title).toBe("Renamed");
  });

  it("title change with no citing sources does not write rename_history", () => {
    const { db, sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Solo" });

    updateItem(db, targetId, { title: "SoloRenamed" });

    const rows = sqlite.prepare("SELECT COUNT(*) AS n FROM rename_history").get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it("first-time title set on empty-title row does NOT sweep (no oldTitle)", () => {
    const { db, sqlite } = createTestDb();
    // Insert directly with empty title to bypass test-utils default
    sqlite
      .prepare(
        `INSERT INTO items_active (id, type, status, title, content, created, modified)
         VALUES ('blank-id', 'note', 'fleeting', '', '', '2026-01-01', '2026-01-01')`,
      )
      .run();
    insertActiveRow(sqlite, { content: "[[Anything]]" });

    updateItem(db, "blank-id", { title: "FirstTitle" });

    const rows = sqlite.prepare("SELECT COUNT(*) AS n FROM rename_history").get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it("non-title updates do not trigger rename engine", () => {
    const { db, sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Stable" });
    const sourceId = insertActiveRow(sqlite, { content: "[[Stable]]" });
    reindexItemReferences(sqlite, sourceId);

    updateItem(db, targetId, { status: "developing" });

    const rows = sqlite.prepare("SELECT COUNT(*) AS n FROM rename_history").get() as { n: number };
    expect(rows.n).toBe(0);

    const src = sqlite.prepare("SELECT content FROM items_active WHERE id = ?").get(sourceId) as {
      content: string;
    };
    expect(src.content).toBe("[[Stable]]");
  });

  it("NFC-equivalent titles do not trigger rename (after normalization)", () => {
    const { db, sqlite } = createTestDb();
    const composed = "Café"; // NFC composed
    const decomposed = "Café"; // NFD decomposed (U+0065 U+0301)
    const targetId = insertActiveRow(sqlite, { title: composed });
    const sourceId = insertActiveRow(sqlite, { content: `[[${composed}]]` });
    reindexItemReferences(sqlite, sourceId);

    // updateItem with the decomposed form — NFC normalization should make
    // it equal to existing.title, so no rename.
    updateItem(db, targetId, { title: decomposed });

    const rows = sqlite.prepare("SELECT COUNT(*) AS n FROM rename_history").get() as { n: number };
    expect(rows.n).toBe(0);
  });
});
