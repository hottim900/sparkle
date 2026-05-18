import { describe, it, expect } from "vitest";
import {
  resolveWikilinkTitle,
  isTitleAvailable,
  markItemReindexDirty,
  reindexItemReferences,
  drainReindexQueue,
} from "../wikilink";
import { createTestDb, insertActiveRow, insertVaultRow } from "../../test-utils.js";

describe("resolveWikilinkTitle", () => {
  it("returns active row when title matches a single active item", () => {
    const { sqlite } = createTestDb();
    const id = insertActiveRow(sqlite, { title: "Foo" });
    const r = resolveWikilinkTitle(sqlite, "Foo");
    expect(r).toEqual({ id, title: "Foo", origin: "active" });
  });

  it("returns null on multiple active matches (collision)", () => {
    const { sqlite } = createTestDb();
    insertActiveRow(sqlite, { title: "Dup" });
    insertActiveRow(sqlite, { title: "Dup" });
    expect(resolveWikilinkTitle(sqlite, "Dup")).toBeNull();
  });

  it("falls back to vault when no active match", () => {
    const { sqlite } = createTestDb();
    const id = insertVaultRow(sqlite, { title: "OnlyInVault" });
    const r = resolveWikilinkTitle(sqlite, "OnlyInVault");
    expect(r).toEqual({ id, title: "OnlyInVault", origin: "vault" });
  });

  it("active priority over vault when both have the title", () => {
    const { sqlite } = createTestDb();
    const activeId = insertActiveRow(sqlite, { title: "BothPlaces" });
    insertVaultRow(sqlite, { title: "BothPlaces" });
    const r = resolveWikilinkTitle(sqlite, "BothPlaces");
    expect(r?.id).toBe(activeId);
    expect(r?.origin).toBe("active");
  });

  it("returns null for ambiguous vault titles", () => {
    const { sqlite } = createTestDb();
    insertVaultRow(sqlite, { title: "VaultDup" });
    insertVaultRow(sqlite, { title: "VaultDup" });
    expect(resolveWikilinkTitle(sqlite, "VaultDup")).toBeNull();
  });

  it("returns null for allowlist titles (未命名)", () => {
    const { sqlite } = createTestDb();
    insertActiveRow(sqlite, { title: "未命名" });
    expect(resolveWikilinkTitle(sqlite, "未命名")).toBeNull();
  });

  it("normalizes case (ASCII) and trim", () => {
    const { sqlite } = createTestDb();
    const id = insertActiveRow(sqlite, { title: "Foo Bar" });
    expect(resolveWikilinkTitle(sqlite, "foo bar")?.id).toBe(id);
    expect(resolveWikilinkTitle(sqlite, "  Foo Bar  ")?.id).toBe(id);
  });

  it("excludes private items by default", () => {
    const { sqlite } = createTestDb();
    insertActiveRow(sqlite, { title: "Secret", is_private: 1 });
    expect(resolveWikilinkTitle(sqlite, "Secret")).toBeNull();
  });

  it("includes private items when opts.includePrivate", () => {
    const { sqlite } = createTestDb();
    const id = insertActiveRow(sqlite, { title: "Secret", is_private: 1 });
    expect(resolveWikilinkTitle(sqlite, "Secret", { includePrivate: true })?.id).toBe(id);
  });

  it("returns null for empty title", () => {
    const { sqlite } = createTestDb();
    expect(resolveWikilinkTitle(sqlite, "")).toBeNull();
    expect(resolveWikilinkTitle(sqlite, "   ")).toBeNull();
  });

  it("resolves a row written via createItem regardless of NFC form on input", async () => {
    const { db, sqlite } = createTestDb();
    const { createItem } = await import("../items.js");
    // "Café" composed at write time: createItem applies NFC
    createItem(db, { title: "Café" });
    // Lookup with decomposed input: U+0065 U+0301
    const decomposedInput = "Café";
    expect(resolveWikilinkTitle(sqlite, decomposedInput)).not.toBeNull();
  });
});

describe("isTitleAvailable", () => {
  it("true when no row holds the title", () => {
    const { sqlite } = createTestDb();
    expect(isTitleAvailable(sqlite, "Free")).toBe(true);
  });

  it("false when another row holds the normalized title", () => {
    const { sqlite } = createTestDb();
    insertActiveRow(sqlite, { title: "Taken" });
    expect(isTitleAvailable(sqlite, "TAKEN")).toBe(false);
    expect(isTitleAvailable(sqlite, "  taken  ")).toBe(false);
  });

  it("true when the holder is the exceptId", () => {
    const { sqlite } = createTestDb();
    const id = insertActiveRow(sqlite, { title: "Same" });
    expect(isTitleAvailable(sqlite, "Same", id)).toBe(true);
  });

  it("allowlist titles always available", () => {
    const { sqlite } = createTestDb();
    insertActiveRow(sqlite, { title: "未命名" });
    expect(isTitleAvailable(sqlite, "未命名")).toBe(true);
  });

  it("does not consult items_vault for collision (scope = active)", () => {
    const { sqlite } = createTestDb();
    insertVaultRow(sqlite, { title: "InVaultOnly" });
    expect(isTitleAvailable(sqlite, "InVaultOnly")).toBe(true);
  });
});

describe("markItemReindexDirty", () => {
  it("flips reindex_dirty=1 for the given ids", () => {
    const { sqlite } = createTestDb();
    const id1 = insertActiveRow(sqlite);
    const id2 = insertActiveRow(sqlite);
    const changed = markItemReindexDirty(sqlite, [id1, id2]);
    expect(changed).toBe(2);
    const rows = sqlite
      .prepare("SELECT id, reindex_dirty FROM items_active WHERE id IN (?, ?)")
      .all(id1, id2) as { id: string; reindex_dirty: number }[];
    expect(rows.every((r) => r.reindex_dirty === 1)).toBe(true);
  });

  it("returns 0 for empty array", () => {
    const { sqlite } = createTestDb();
    expect(markItemReindexDirty(sqlite, [])).toBe(0);
  });

  it("silently skips non-existent ids", () => {
    const { sqlite } = createTestDb();
    expect(markItemReindexDirty(sqlite, ["does-not-exist"])).toBe(0);
  });
});

describe("reindexItemReferences", () => {
  it("inserts reference_index rows for resolved wikilinks", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Target" });
    const sourceId = insertActiveRow(sqlite, { content: "see [[Target]] please" });

    reindexItemReferences(sqlite, sourceId);

    const refs = sqlite
      .prepare("SELECT * FROM reference_index WHERE source_id = ?")
      .all(sourceId) as {
      source_id: string;
      target_id: string;
      char_offset: number;
      raw_title: string;
      kind: string;
    }[];
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      source_id: sourceId,
      target_id: targetId,
      raw_title: "Target",
      kind: "wikilink",
    });
  });

  it("clears reindex_dirty after successful reindex", () => {
    const { sqlite } = createTestDb();
    const sourceId = insertActiveRow(sqlite, { content: "no refs" });
    markItemReindexDirty(sqlite, [sourceId]);
    reindexItemReferences(sqlite, sourceId);
    const row = sqlite
      .prepare("SELECT reindex_dirty FROM items_active WHERE id = ?")
      .get(sourceId) as { reindex_dirty: number };
    expect(row.reindex_dirty).toBe(0);
  });

  it("skips unresolved wikilinks (no index row)", () => {
    const { sqlite } = createTestDb();
    const sourceId = insertActiveRow(sqlite, { content: "[[NoSuchTitle]]" });
    reindexItemReferences(sqlite, sourceId);
    const refs = sqlite.prepare("SELECT * FROM reference_index WHERE source_id = ?").all(sourceId);
    expect(refs).toHaveLength(0);
  });

  it("indexes legacy 筆記（xxxx） as kind='legacy_hex'", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { id: "abcd1234-0000-4000-8000-000000000000" });
    const sourceId = insertActiveRow(sqlite, { content: "see 筆記（abcd1234）" });

    reindexItemReferences(sqlite, sourceId);

    const refs = sqlite
      .prepare("SELECT target_id, kind, raw_title FROM reference_index WHERE source_id = ?")
      .all(sourceId) as { target_id: string; kind: string; raw_title: string }[];
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      target_id: targetId,
      kind: "legacy_hex",
      raw_title: "abcd1234",
    });
  });

  it("replaces stale index rows on re-reindex", () => {
    const { sqlite } = createTestDb();
    const a = insertActiveRow(sqlite, { title: "A" });
    insertActiveRow(sqlite, { title: "B" });
    const sourceId = insertActiveRow(sqlite, { content: "[[A]]" });
    reindexItemReferences(sqlite, sourceId);

    sqlite.prepare("UPDATE items_active SET content = '[[B]]' WHERE id = ?").run(sourceId);
    reindexItemReferences(sqlite, sourceId);

    const refs = sqlite
      .prepare("SELECT target_id, raw_title FROM reference_index WHERE source_id = ?")
      .all(sourceId) as { target_id: string; raw_title: string }[];
    expect(refs).toHaveLength(1);
    expect(refs[0]!.raw_title).toBe("B");
    expect(refs[0]!.target_id).not.toBe(a);
  });

  it("CASCADE deletes reference_index rows when source is deleted", () => {
    const { sqlite } = createTestDb();
    insertActiveRow(sqlite, { title: "Target" });
    const sourceId = insertActiveRow(sqlite, { content: "[[Target]]" });
    reindexItemReferences(sqlite, sourceId);

    sqlite.prepare("DELETE FROM items_active WHERE id = ?").run(sourceId);
    const refs = sqlite.prepare("SELECT * FROM reference_index").all();
    expect(refs).toHaveLength(0);
  });
});

describe("drainReindexQueue", () => {
  it("processes rows where reindex_dirty=1 and clears the flag", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "T" });
    const sourceId = insertActiveRow(sqlite, { content: "[[T]]" });
    markItemReindexDirty(sqlite, [sourceId]);

    const count = drainReindexQueue(sqlite, 10);
    expect(count).toBe(1);

    const dirty = sqlite
      .prepare("SELECT COUNT(*) AS n FROM items_active WHERE reindex_dirty = 1")
      .get() as { n: number };
    expect(dirty.n).toBe(0);

    const refs = sqlite.prepare("SELECT target_id FROM reference_index").all() as {
      target_id: string;
    }[];
    expect(refs[0]?.target_id).toBe(targetId);
  });

  it("respects the batch limit", () => {
    const { sqlite } = createTestDb();
    for (let i = 0; i < 5; i++) insertActiveRow(sqlite, { title: `t-${i}`, content: "no refs" });
    sqlite.prepare("UPDATE items_active SET reindex_dirty = 1").run();

    expect(drainReindexQueue(sqlite, 2)).toBe(2);
    const remaining = sqlite
      .prepare("SELECT COUNT(*) AS n FROM items_active WHERE reindex_dirty = 1")
      .get() as { n: number };
    expect(remaining.n).toBe(3);
  });

  it("returns 0 when the queue is empty", () => {
    const { sqlite } = createTestDb();
    expect(drainReindexQueue(sqlite, 10)).toBe(0);
  });
});
