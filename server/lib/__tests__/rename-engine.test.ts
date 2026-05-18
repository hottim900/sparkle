import { describe, it, expect } from "vitest";
import {
  applyTitleRename,
  computeRenameStateHash,
  previewTitleRename,
  RenameStateChangedError,
  rewriteWikilinks,
  undoRename,
} from "../rename-engine.js";
import { reindexItemReferences } from "../wikilink.js";
import { createTestDb, insertActiveRow } from "../../test-utils.js";

describe("rewriteWikilinks", () => {
  it("returns content unchanged when no refs", () => {
    expect(rewriteWikilinks("hello world", "Old", "New")).toBe("hello world");
  });

  it("rewrites a single [[Old]] to [[New]]", () => {
    expect(rewriteWikilinks("see [[Old]] please", "Old", "New")).toBe("see [[New]] please");
  });

  it("preserves alias when rewriting", () => {
    expect(rewriteWikilinks("see [[Old|display]] now", "Old", "New")).toBe(
      "see [[New|display]] now",
    );
  });

  it("rewrites only matching titles", () => {
    expect(rewriteWikilinks("[[Old]] [[Other]] [[Old|x]]", "Old", "New")).toBe(
      "[[New]] [[Other]] [[New|x]]",
    );
  });

  it("skips refs inside code blocks", () => {
    const before = "before [[Old]]\n```\n[[Old]]\n```\nafter [[Old]]";
    const after = rewriteWikilinks(before, "Old", "New");
    expect(after).toBe("before [[New]]\n```\n[[Old]]\n```\nafter [[New]]");
  });

  it("processes multiple refs in descending offset order without corruption", () => {
    const before = "[[A]] then [[A]] and [[A]]";
    expect(rewriteWikilinks(before, "A", "Bxx")).toBe("[[Bxx]] then [[Bxx]] and [[Bxx]]");
  });
});

describe("applyTitleRename", () => {
  it("returns 0 when target has no incoming refs", () => {
    const { sqlite } = createTestDb();
    const id = insertActiveRow(sqlite, { title: "Lonely" });
    const r = applyTitleRename(sqlite, id, "Lonely", "Renamed");
    expect(r.rewrittenCount).toBe(0);
    expect(r.historyId).toBeNull();
  });

  it("rewrites a single source citing the target", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Original" });
    const sourceId = insertActiveRow(sqlite, { content: "see [[Original]] please" });
    reindexItemReferences(sqlite, sourceId);

    const r = applyTitleRename(sqlite, targetId, "Original", "Renamed");
    expect(r.rewrittenCount).toBe(1);
    expect(r.rewrittenSourceIds).toEqual([sourceId]);

    const newContent = sqlite
      .prepare("SELECT content FROM items_active WHERE id = ?")
      .get(sourceId) as { content: string };
    expect(newContent.content).toBe("see [[Renamed]] please");
  });

  it("marks rewritten sources reindex_dirty=1", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "T" });
    const sourceId = insertActiveRow(sqlite, { content: "[[T]]" });
    reindexItemReferences(sqlite, sourceId);
    sqlite.prepare("UPDATE items_active SET reindex_dirty = 0 WHERE id = ?").run(sourceId);

    applyTitleRename(sqlite, targetId, "T", "U");

    const row = sqlite
      .prepare("SELECT reindex_dirty FROM items_active WHERE id = ?")
      .get(sourceId) as { reindex_dirty: number };
    expect(row.reindex_dirty).toBe(1);
  });

  it("writes a rename_history row on success", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "T" });
    const sourceId = insertActiveRow(sqlite, { content: "[[T]]" });
    reindexItemReferences(sqlite, sourceId);

    const r = applyTitleRename(sqlite, targetId, "T", "U", "user");
    expect(r.historyId).toBeTruthy();

    const row = sqlite
      .prepare(
        "SELECT target_id, old_title, new_title, source_count, performed_by FROM rename_history WHERE id = ?",
      )
      .get(r.historyId!) as {
      target_id: string;
      old_title: string;
      new_title: string;
      source_count: number;
      performed_by: string;
    };
    expect(row).toEqual({
      target_id: targetId,
      old_title: "T",
      new_title: "U",
      source_count: 1,
      performed_by: "user",
    });
  });

  it("preserves alias on rewritten refs", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Real" });
    const sourceId = insertActiveRow(sqlite, { content: "see [[Real|short]] here" });
    reindexItemReferences(sqlite, sourceId);

    applyTitleRename(sqlite, targetId, "Real", "Renamed");

    const newContent = sqlite
      .prepare("SELECT content FROM items_active WHERE id = ?")
      .get(sourceId) as { content: string };
    expect(newContent.content).toBe("see [[Renamed|short]] here");
  });

  it("no-op when oldTitle === newTitle", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Same" });
    const sourceId = insertActiveRow(sqlite, { content: "[[Same]]" });
    reindexItemReferences(sqlite, sourceId);

    const r = applyTitleRename(sqlite, targetId, "Same", "Same");
    expect(r.rewrittenCount).toBe(0);
    expect(r.historyId).toBeNull();
  });

  it("no-op when oldTitle is empty", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "X" });
    const r = applyTitleRename(sqlite, targetId, "", "X");
    expect(r.rewrittenCount).toBe(0);
  });

  it("ignores legacy_hex references (target by id, not title)", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, {
      id: "abcd1234-0000-4000-8000-000000000000",
      title: "Original",
    });
    const sourceId = insertActiveRow(sqlite, { content: "see 筆記（abcd1234）" });
    reindexItemReferences(sqlite, sourceId);

    const refs = sqlite
      .prepare("SELECT kind FROM reference_index WHERE source_id = ?")
      .all(sourceId) as { kind: string }[];
    expect(refs[0]!.kind).toBe("legacy_hex");

    const r = applyTitleRename(sqlite, targetId, "Original", "Renamed");
    expect(r.rewrittenCount).toBe(0);
  });

  it("rewrites multiple sources in one tx", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Hub" });
    const sourceA = insertActiveRow(sqlite, { content: "[[Hub]] a" });
    const sourceB = insertActiveRow(sqlite, { content: "b [[Hub]]" });
    reindexItemReferences(sqlite, sourceA);
    reindexItemReferences(sqlite, sourceB);

    const r = applyTitleRename(sqlite, targetId, "Hub", "Centre");
    expect(r.rewrittenCount).toBe(2);
    expect(r.rewrittenSourceIds).toEqual(expect.arrayContaining([sourceA, sourceB]));
  });
});

describe("DX-2 state-hash race guard", () => {
  it("preview returns a state_hash that applyTitleRename accepts", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Stable" });
    const sourceId = insertActiveRow(sqlite, { content: "see [[Stable]] here" });
    reindexItemReferences(sqlite, sourceId);

    const preview = previewTitleRename(sqlite, targetId, "Stable", "Renamed");
    expect(preview.stateHash).toMatch(/^[a-f0-9]{64}$/);

    // Hash from preview lets the commit through.
    const result = applyTitleRename(
      sqlite,
      targetId,
      "Stable",
      "Renamed",
      "user",
      preview.stateHash,
    );
    expect(result.rewrittenCount).toBe(1);
  });

  it("applyTitleRename throws when expected_state_hash doesn't match", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Stable" });
    const sourceId = insertActiveRow(sqlite, { content: "see [[Stable]] here" });
    reindexItemReferences(sqlite, sourceId);

    const stale = "0".repeat(64);
    expect(() => applyTitleRename(sqlite, targetId, "Stable", "Renamed", "user", stale)).toThrow(
      RenameStateChangedError,
    );
  });

  it("hash changes when a source edits its content between preview and commit", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Stable" });
    const sourceId = insertActiveRow(sqlite, { content: "see [[Stable]] here" });
    reindexItemReferences(sqlite, sourceId);

    const before = previewTitleRename(sqlite, targetId, "Stable", "Renamed");

    // Racing edit: source body changes (adds a second wikilink to the target).
    sqlite
      .prepare("UPDATE items_active SET content = ? WHERE id = ?")
      .run("see [[Stable]] and [[Stable]] here", sourceId);

    const after = computeRenameStateHash(sqlite, targetId, "Stable");
    expect(after).not.toBe(before.stateHash);
    expect(() =>
      applyTitleRename(sqlite, targetId, "Stable", "Renamed", "user", before.stateHash),
    ).toThrow(RenameStateChangedError);
  });

  it("hash changes when a new source starts citing the target", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Stable" });
    const sourceA = insertActiveRow(sqlite, { content: "see [[Stable]]" });
    reindexItemReferences(sqlite, sourceA);

    const before = computeRenameStateHash(sqlite, targetId, "Stable");
    const sourceB = insertActiveRow(sqlite, { content: "also [[Stable]]" });
    reindexItemReferences(sqlite, sourceB);
    const after = computeRenameStateHash(sqlite, targetId, "Stable");
    expect(after).not.toBe(before);
  });
});

describe("undoRename", () => {
  it("returns null when historyId doesn't exist", () => {
    const { sqlite } = createTestDb();
    expect(undoRename(sqlite, "no-such-id")).toBeNull();
  });

  it("reverses the rewrite", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Original" });
    const sourceId = insertActiveRow(sqlite, { content: "[[Original]]" });
    reindexItemReferences(sqlite, sourceId);

    // Forward rename via items.ts updateItem path (we test the engine
    // direct here): simulate by setting title + invoking engine.
    sqlite.prepare("UPDATE items_active SET title = ? WHERE id = ?").run("Renamed", targetId);
    const forward = applyTitleRename(sqlite, targetId, "Original", "Renamed");

    // Worker re-indexes after rewrite so the index sees [[Renamed]] now.
    reindexItemReferences(sqlite, sourceId);

    const undo = undoRename(sqlite, forward.historyId!);
    expect(undo).not.toBeNull();
    expect(undo!.rewrittenCount).toBe(1);

    const newContent = sqlite
      .prepare("SELECT content FROM items_active WHERE id = ?")
      .get(sourceId) as { content: string };
    expect(newContent.content).toBe("[[Original]]");

    const targetTitle = sqlite
      .prepare("SELECT title FROM items_active WHERE id = ?")
      .get(targetId) as { title: string };
    expect(targetTitle.title).toBe("Original");
  });

  it("records the undo itself in rename_history", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "X" });
    const sourceId = insertActiveRow(sqlite, { content: "[[X]]" });
    reindexItemReferences(sqlite, sourceId);
    sqlite.prepare("UPDATE items_active SET title = ? WHERE id = ?").run("Y", targetId);
    const forward = applyTitleRename(sqlite, targetId, "X", "Y");
    reindexItemReferences(sqlite, sourceId);

    undoRename(sqlite, forward.historyId!);

    const rows = sqlite.prepare("SELECT performed_by FROM rename_history").all() as {
      performed_by: string;
    }[];
    expect(rows).toHaveLength(2);
    // Two rows in the same SQL transaction often share a millisecond-precision
    // performed_at timestamp, so don't assert order — just assert content.
    const performedBy = rows.map((r) => r.performed_by);
    expect(performedBy).toEqual(expect.arrayContaining(["system", `undo:${forward.historyId}`]));
  });
});
