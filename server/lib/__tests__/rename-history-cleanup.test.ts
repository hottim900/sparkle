import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../../test-utils.js";
import {
  pruneRenameHistory,
  checkAndPruneRenameHistory,
  resetRenameHistoryCleanupForTest,
} from "../rename-history-cleanup.js";

function insertHistoryRow(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  performedAt: string,
  id: string = crypto.randomUUID(),
) {
  sqlite
    .prepare(
      `INSERT INTO rename_history
         (id, target_id, old_title, new_title, source_count, performed_at, performed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, "target", "old", "new", 1, performedAt, "user");
}

describe("rename-history-cleanup", () => {
  beforeEach(() => {
    resetRenameHistoryCleanupForTest();
  });

  it("pruneRenameHistory deletes rows older than 30 days", () => {
    const { sqlite } = createTestDb();
    const now = new Date("2026-05-18T00:00:00Z");

    // 31 days ago — should be deleted
    insertHistoryRow(sqlite, "2026-04-16T00:00:00Z", "old1");
    // 100 days ago — should be deleted
    insertHistoryRow(sqlite, "2026-02-07T00:00:00Z", "old2");
    // 15 days ago — should be kept
    insertHistoryRow(sqlite, "2026-05-03T00:00:00Z", "recent");

    const deleted = pruneRenameHistory(sqlite, now);
    expect(deleted).toBe(2);

    const rows = sqlite.prepare("SELECT id FROM rename_history ORDER BY id").all() as {
      id: string;
    }[];
    expect(rows.map((r) => r.id)).toEqual(["recent"]);
  });

  it("pruneRenameHistory is a no-op when nothing is older than 30 days", () => {
    const { sqlite } = createTestDb();
    // Use explicit fixed dates instead of `new Date().toISOString()` —
    // running near a day boundary could otherwise flip rows in/out of the
    // 30d window between insert and prune.
    const now = new Date("2026-05-18T00:00:00Z");
    insertHistoryRow(sqlite, "2026-05-17T23:00:00Z");

    const deleted = pruneRenameHistory(sqlite, now);
    expect(deleted).toBe(0);
  });

  it("checkAndPruneRenameHistory short-circuits within 24h of last run", () => {
    const { sqlite } = createTestDb();
    insertHistoryRow(sqlite, "2020-01-01T00:00:00Z", "ancient");

    // First call: runs the prune, deletes 1
    checkAndPruneRenameHistory(sqlite);
    let count = sqlite.prepare("SELECT COUNT(*) AS n FROM rename_history").get() as { n: number };
    expect(count.n).toBe(0);

    // Insert a fresh ancient row; second call within 24h should NOT prune
    insertHistoryRow(sqlite, "2020-01-01T00:00:00Z", "ancient2");
    checkAndPruneRenameHistory(sqlite);
    count = sqlite.prepare("SELECT COUNT(*) AS n FROM rename_history").get() as { n: number };
    expect(count.n).toBe(1); // still present — throttled
  });

  it("checkAndPruneRenameHistory runs again after 24h throttle expires", () => {
    const { sqlite } = createTestDb();
    insertHistoryRow(sqlite, "2020-01-01T00:00:00Z", "ancient");

    // First run: prunes
    checkAndPruneRenameHistory(sqlite);
    expect(
      (sqlite.prepare("SELECT COUNT(*) AS n FROM rename_history").get() as { n: number }).n,
    ).toBe(0);

    // Simulate >24h elapsed by resetting the in-module timer
    resetRenameHistoryCleanupForTest();
    insertHistoryRow(sqlite, "2020-01-01T00:00:00Z", "ancient2");

    checkAndPruneRenameHistory(sqlite);
    expect(
      (sqlite.prepare("SELECT COUNT(*) AS n FROM rename_history").get() as { n: number }).n,
    ).toBe(0);
  });
});
