import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createTestDb } from "../../test-utils.js";
import { createItem, updateItem, getItem } from "../items.js";
import { computeRevision, RevisionMismatchError } from "../revision.js";

/**
 * Pre-PR0b: updateItem honors optional `revision` compare-and-swap token.
 * Without this guard, the upcoming rename engine (PR3) rewriting a source
 * item's content silently clobbers a parallel edit_note save (ENG-2/17).
 */

describe("updateItem CAS revision guard", () => {
  let db: ReturnType<typeof drizzle>;
  let sqlite: Database.Database;

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  function makeItem(content = "original body") {
    return createItem(db, { title: "T", content });
  }

  it("succeeds when caller's revision matches stored content", () => {
    const item = makeItem("hello world");
    const rev = computeRevision("hello world");
    const updated = updateItem(db, item.id, { content: "hello world!", revision: rev });
    expect(updated).not.toBeNull();
    expect(updated!.content).toBe("hello world!");
  });

  it("throws RevisionMismatchError when stored content drifted", () => {
    const item = makeItem("v1");
    // Simulate a concurrent write that bumped the content.
    updateItem(db, item.id, { content: "v2-from-elsewhere" });

    const staleRev = computeRevision("v1");
    expect(() => updateItem(db, item.id, { content: "v2-from-me", revision: staleRev })).toThrow(
      RevisionMismatchError,
    );
  });

  it("RevisionMismatchError carries the current content for client merge", () => {
    const item = makeItem("a");
    updateItem(db, item.id, { content: "b" });
    const staleRev = computeRevision("a");
    try {
      updateItem(db, item.id, { content: "c", revision: staleRev });
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RevisionMismatchError);
      const err = e as RevisionMismatchError;
      expect(err.itemId).toBe(item.id);
      expect(err.expected).toBe(staleRev);
      expect(err.actual).toBe(computeRevision("b"));
      expect(err.currentContent).toBe("b");
    }
  });

  it("skips CAS entirely when caller omits revision (backwards compatible)", () => {
    const item = makeItem("anything");
    const updated = updateItem(db, item.id, { content: "no revision supplied" });
    expect(updated).not.toBeNull();
    expect(updated!.content).toBe("no revision supplied");
  });

  it("does not persist the `revision` field as a column", () => {
    const item = makeItem("body");
    const rev = computeRevision("body");
    updateItem(db, item.id, { title: "new title", revision: rev });
    const cols = sqlite.prepare("PRAGMA table_info(items_active)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "revision")).toBe(false);
    const refetched = getItem(db, item.id);
    expect(refetched!.title).toBe("new title");
  });

  it("matches against the empty-content revision for items without content", () => {
    // Items can be created with empty body; their canonical revision is
    // sha256(""). A title-only PATCH that supplies the empty-content
    // revision must succeed.
    const item = createItem(db, { title: "T" });
    expect(item.content === null || item.content === "").toBe(true);
    const emptyRev = computeRevision("");
    const updated = updateItem(db, item.id, { title: "Renamed", revision: emptyRev });
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe("Renamed");
  });

  it("rejects with the wrong revision even when no content change is intended", () => {
    // A title-only rename with a stale revision still trips CAS — the
    // engine intentionally refuses to silently overwrite content
    // out-of-band edits may have applied.
    const item = makeItem("body");
    updateItem(db, item.id, { content: "body+" });
    const staleRev = computeRevision("body");
    expect(() => updateItem(db, item.id, { title: "Renamed", revision: staleRev })).toThrow(
      RevisionMismatchError,
    );
  });
});
