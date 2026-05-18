import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, insertActiveRow } from "../../test-utils.js";
import { applyTitleRename } from "../rename-engine.js";

/**
 * ENG-3: rename engine must skip sources with active share_tokens when the
 * target is private. The current resolver (server/lib/wikilink.ts) filters
 * `is_private = 0` so private targets normally never accumulate reference_index
 * entries — this guard is defense-in-depth for the case where:
 *   - An admin debug path inserts reference_index rows manually.
 *   - A future change makes private wikilinks resolvable for authenticated
 *     surfaces (logged-in renderer / own-user dashboard).
 *
 * Tests insert reference_index rows directly to exercise the engine's skip
 * logic regardless of how the index got populated.
 */

function insertShareToken(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  itemId: string,
  visibility: "public" | "unlisted" = "public",
) {
  sqlite
    .prepare(
      `INSERT INTO share_tokens (id, item_id, token, visibility, created)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), itemId, randomUUID(), visibility, new Date().toISOString());
}

function indexRef(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  sourceId: string,
  targetId: string,
  rawTitle: string,
  charOffset: number,
) {
  sqlite
    .prepare(
      `INSERT INTO reference_index (source_id, target_id, char_offset, raw_title, kind)
       VALUES (?, ?, ?, ?, 'wikilink')`,
    )
    .run(sourceId, targetId, charOffset, rawTitle);
}

describe("ENG-3 share_token leak guard", () => {
  it("skips rewrite when target is private AND source has an active share_token", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Private Idea", is_private: 1 });
    const sharedSourceId = insertActiveRow(sqlite, { content: "see [[Private Idea]]" });
    insertShareToken(sqlite, sharedSourceId);
    indexRef(sqlite, sharedSourceId, targetId, "Private Idea", 4);

    const result = applyTitleRename(sqlite, targetId, "Private Idea", "Updated Idea");

    // Source content untouched
    const row = sqlite
      .prepare("SELECT content FROM items_active WHERE id = ?")
      .get(sharedSourceId) as { content: string };
    expect(row.content).toBe("see [[Private Idea]]");

    expect(result.skippedShareTokenSourceIds).toEqual([sharedSourceId]);
    expect(result.rewrittenCount).toBe(0);
  });

  it("still rewrites non-shared sources when target is private", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Private Idea", is_private: 1 });

    const sharedSourceId = insertActiveRow(sqlite, { content: "shared [[Private Idea]]" });
    insertShareToken(sqlite, sharedSourceId);
    indexRef(sqlite, sharedSourceId, targetId, "Private Idea", 7);

    const unsharedSourceId = insertActiveRow(sqlite, { content: "private [[Private Idea]]" });
    indexRef(sqlite, unsharedSourceId, targetId, "Private Idea", 8);

    const result = applyTitleRename(sqlite, targetId, "Private Idea", "Updated Idea");

    const shared = sqlite
      .prepare("SELECT content FROM items_active WHERE id = ?")
      .get(sharedSourceId) as { content: string };
    expect(shared.content).toBe("shared [[Private Idea]]"); // untouched

    const unshared = sqlite
      .prepare("SELECT content FROM items_active WHERE id = ?")
      .get(unsharedSourceId) as { content: string };
    expect(unshared.content).toBe("private [[Updated Idea]]"); // rewritten

    expect(result.skippedShareTokenSourceIds).toEqual([sharedSourceId]);
    expect(result.rewrittenSourceIds).toEqual([unsharedSourceId]);
    expect(result.rewrittenCount).toBe(1);
  });

  it("DOES rewrite shared sources when target is public (no leak risk)", () => {
    const { sqlite } = createTestDb();
    // is_private defaults to 0 — target is public
    const targetId = insertActiveRow(sqlite, { title: "Public Idea" });
    const sharedSourceId = insertActiveRow(sqlite, { content: "see [[Public Idea]]" });
    insertShareToken(sqlite, sharedSourceId);
    indexRef(sqlite, sharedSourceId, targetId, "Public Idea", 4);

    const result = applyTitleRename(sqlite, targetId, "Public Idea", "Renamed Public");

    const row = sqlite
      .prepare("SELECT content FROM items_active WHERE id = ?")
      .get(sharedSourceId) as { content: string };
    expect(row.content).toBe("see [[Renamed Public]]"); // rewritten

    expect(result.skippedShareTokenSourceIds).toEqual([]);
    expect(result.rewrittenSourceIds).toEqual([sharedSourceId]);
  });

  it("skips unlisted shares too (any share_token row counts as 'shared')", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Private Note", is_private: 1 });
    const sourceId = insertActiveRow(sqlite, { content: "[[Private Note]]" });
    insertShareToken(sqlite, sourceId, "unlisted");
    indexRef(sqlite, sourceId, targetId, "Private Note", 0);

    const result = applyTitleRename(sqlite, targetId, "Private Note", "New Name");

    expect(result.skippedShareTokenSourceIds).toEqual([sourceId]);
    expect(result.rewrittenCount).toBe(0);
  });

  it("rewrites all sources when target is private but none are shared", () => {
    const { sqlite } = createTestDb();
    const targetId = insertActiveRow(sqlite, { title: "Private", is_private: 1 });
    const id1 = insertActiveRow(sqlite, { content: "[[Private]]" });
    const id2 = insertActiveRow(sqlite, { content: "also [[Private]]" });
    indexRef(sqlite, id1, targetId, "Private", 0);
    indexRef(sqlite, id2, targetId, "Private", 5);

    const result = applyTitleRename(sqlite, targetId, "Private", "Renamed");

    expect(result.skippedShareTokenSourceIds).toEqual([]);
    expect(result.rewrittenCount).toBe(2);
  });
});
