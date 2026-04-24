import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createTestDb } from "../../test-utils.js";
import { getWeekData } from "../stats.js";

/**
 * Helper: insert an item with explicit created/modified timestamps.
 * Uses raw SQL to bypass createItem's auto-generated timestamps.
 */
function insertRawItem(
  sqlite: Database.Database,
  overrides: {
    id?: string;
    type?: string;
    title?: string;
    status?: string;
    priority?: string | null;
    due?: string | null;
    created?: string;
    modified?: string;
    is_private?: number;
  },
) {
  const id = overrides.id ?? crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO items_active (id, type, title, content, status, priority, due, tags, origin, source, aliases, created, modified, is_private, viewed_at)
       VALUES (?, ?, ?, '', ?, ?, ?, '[]', '', NULL, '[]', ?, ?, ?, NULL)`,
    )
    .run(
      id,
      overrides.type ?? "note",
      overrides.title ?? "Test item",
      overrides.status ?? "fleeting",
      overrides.priority ?? null,
      overrides.due ?? null,
      overrides.created ?? new Date().toISOString(),
      overrides.modified ?? new Date().toISOString(),
      overrides.is_private ?? 0,
    );
  return id;
}

describe("getWeekData", () => {
  let sqlite: Database.Database;

  // Use a fixed Monday for testing: 2026-03-23 (Monday)
  const monday = "2026-03-23";

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    sqlite?.close();
  });

  it("returns 7 days starting from the given Monday", () => {
    const result = getWeekData(sqlite, monday);
    expect(result.days).toHaveLength(7);
    expect(result.days[0]!.date).toBe("2026-03-23");
    expect(result.days[1]!.date).toBe("2026-03-24");
    expect(result.days[2]!.date).toBe("2026-03-25");
    expect(result.days[3]!.date).toBe("2026-03-26");
    expect(result.days[4]!.date).toBe("2026-03-27");
    expect(result.days[5]!.date).toBe("2026-03-28");
    expect(result.days[6]!.date).toBe("2026-03-29");
  });

  it("returns empty arrays when no items exist", () => {
    const result = getWeekData(sqlite, monday);
    for (const day of result.days) {
      expect(day.todos_due).toEqual([]);
      expect(day.notes_created).toEqual([]);
      expect(day.notes_modified).toEqual([]);
    }
  });

  it("buckets todos_due by their due date", () => {
    insertRawItem(sqlite, {
      type: "todo",
      title: "Todo Mon",
      status: "active",
      priority: "high",
      due: "2026-03-23",
    });
    insertRawItem(sqlite, {
      type: "todo",
      title: "Todo Wed",
      status: "active",
      priority: null,
      due: "2026-03-25",
    });
    insertRawItem(sqlite, {
      type: "todo",
      title: "Todo Sun",
      status: "active",
      due: "2026-03-29",
    });

    const result = getWeekData(sqlite, monday);

    // Monday
    expect(result.days[0]!.todos_due).toHaveLength(1);
    expect(result.days[0]!.todos_due[0]!.title).toBe("Todo Mon");
    expect(result.days[0]!.todos_due[0]!.priority).toBe("high");
    expect(result.days[0]!.todos_due[0]!.status).toBe("active");

    // Wednesday
    expect(result.days[2]!.todos_due).toHaveLength(1);
    expect(result.days[2]!.todos_due[0]!.title).toBe("Todo Wed");

    // Sunday
    expect(result.days[6]!.todos_due).toHaveLength(1);
    expect(result.days[6]!.todos_due[0]!.title).toBe("Todo Sun");

    // Other days empty
    expect(result.days[1]!.todos_due).toEqual([]);
    expect(result.days[3]!.todos_due).toEqual([]);
  });

  it("buckets notes_created by their local creation date", () => {
    // Create a note on Tuesday (2026-03-24) local time
    // Local midnight of 2026-03-24 in UTC
    const tuesdayLocal = new Date(2026, 2, 24, 10, 30, 0); // 10:30 AM local
    insertRawItem(sqlite, {
      type: "note",
      title: "Note Tue",
      status: "fleeting",
      created: tuesdayLocal.toISOString(),
      modified: tuesdayLocal.toISOString(),
    });

    const result = getWeekData(sqlite, monday);

    // Tuesday (index 1)
    expect(result.days[1]!.notes_created).toHaveLength(1);
    expect(result.days[1]!.notes_created[0]!.title).toBe("Note Tue");
    expect(result.days[1]!.notes_created[0]!.status).toBe("fleeting");
  });

  it("buckets notes_modified and deduplicates with notes_created on same day", () => {
    const wednesdayCreated = new Date(2026, 2, 25, 9, 0, 0);
    const wednesdayModified = new Date(2026, 2, 25, 15, 0, 0);
    const noteId = crypto.randomUUID();

    // A note created and modified on the same day (Wednesday)
    insertRawItem(sqlite, {
      id: noteId,
      type: "note",
      title: "Note created+modified Wed",
      status: "developing",
      created: wednesdayCreated.toISOString(),
      modified: wednesdayModified.toISOString(),
    });

    // A note created before the week but modified on Thursday
    const beforeWeek = new Date(2026, 2, 15, 12, 0, 0);
    const thursdayModified = new Date(2026, 2, 26, 14, 0, 0);
    insertRawItem(sqlite, {
      type: "note",
      title: "Note modified Thu",
      status: "developing",
      created: beforeWeek.toISOString(),
      modified: thursdayModified.toISOString(),
    });

    const result = getWeekData(sqlite, monday);

    // Wednesday: should appear in notes_created but NOT in notes_modified (dedup)
    expect(result.days[2]!.notes_created).toHaveLength(1);
    expect(result.days[2]!.notes_created[0]!.title).toBe("Note created+modified Wed");
    expect(result.days[2]!.notes_modified).toHaveLength(0);

    // Thursday: only in notes_modified (created before the week)
    expect(result.days[3]!.notes_created).toEqual([]);
    expect(result.days[3]!.notes_modified).toHaveLength(1);
    expect(result.days[3]!.notes_modified[0]!.title).toBe("Note modified Thu");
  });

  it("shows cross-day modifications — note created Monday, modified Friday", () => {
    const mondayCreated = new Date(2026, 2, 23, 10, 0, 0);
    const fridayModified = new Date(2026, 2, 27, 14, 0, 0);
    const noteId = crypto.randomUUID();

    insertRawItem(sqlite, {
      id: noteId,
      type: "note",
      title: "Cross-day note",
      status: "developing",
      created: mondayCreated.toISOString(),
      modified: fridayModified.toISOString(),
    });

    const result = getWeekData(sqlite, monday);

    // Monday: should appear in notes_created
    expect(result.days[0]!.notes_created).toHaveLength(1);
    expect(result.days[0]!.notes_created[0]!.title).toBe("Cross-day note");

    // Friday: should appear in notes_modified (different day, no dedup)
    expect(result.days[4]!.notes_modified).toHaveLength(1);
    expect(result.days[4]!.notes_modified[0]!.title).toBe("Cross-day note");
  });

  it("excludes archived notes from notes_created and notes_modified", () => {
    const tuesdayLocal = new Date(2026, 2, 24, 10, 0, 0);
    insertRawItem(sqlite, {
      type: "note",
      title: "Archived note",
      status: "archived",
      created: tuesdayLocal.toISOString(),
      modified: tuesdayLocal.toISOString(),
    });

    const result = getWeekData(sqlite, monday);
    expect(result.days[1]!.notes_created).toHaveLength(0);
    expect(result.days[1]!.notes_modified).toHaveLength(0);
  });

  it("excludes private items from all results", () => {
    // Public todo
    insertRawItem(sqlite, {
      type: "todo",
      title: "Public Todo",
      status: "active",
      due: "2026-03-23",
      is_private: 0,
    });

    // Private todo
    insertRawItem(sqlite, {
      type: "todo",
      title: "Private Todo",
      status: "active",
      due: "2026-03-23",
      is_private: 1,
    });

    // Public note
    const monLocal = new Date(2026, 2, 23, 10, 0, 0);
    insertRawItem(sqlite, {
      type: "note",
      title: "Public Note",
      status: "fleeting",
      created: monLocal.toISOString(),
      modified: monLocal.toISOString(),
      is_private: 0,
    });

    // Private note
    insertRawItem(sqlite, {
      type: "note",
      title: "Private Note",
      status: "fleeting",
      created: monLocal.toISOString(),
      modified: monLocal.toISOString(),
      is_private: 1,
    });

    const result = getWeekData(sqlite, monday);

    // Only public items should appear
    expect(result.days[0]!.todos_due).toHaveLength(1);
    expect(result.days[0]!.todos_due[0]!.title).toBe("Public Todo");

    expect(result.days[0]!.notes_created).toHaveLength(1);
    expect(result.days[0]!.notes_created[0]!.title).toBe("Public Note");
  });

  it("computes overdue_count relative to each historical day", () => {
    // A todo due on Monday 2026-03-23
    insertRawItem(sqlite, {
      type: "todo",
      title: "Due Monday",
      status: "active",
      due: "2026-03-23",
    });

    // A todo due on Wednesday 2026-03-25
    insertRawItem(sqlite, {
      type: "todo",
      title: "Due Wednesday",
      status: "active",
      due: "2026-03-25",
    });

    const result = getWeekData(sqlite, monday);

    // Monday (03-23): nothing is overdue (due ON Monday is not overdue on Monday)
    expect(result.days[0]!.overdue_count).toBe(0);

    // Tuesday (03-24): "Due Monday" is overdue (due < 03-24)
    expect(result.days[1]!.overdue_count).toBe(1);

    // Wednesday (03-25): "Due Monday" is overdue
    expect(result.days[2]!.overdue_count).toBe(1);

    // Thursday (03-26): both "Due Monday" and "Due Wednesday" are overdue
    expect(result.days[3]!.overdue_count).toBe(2);

    // Sunday (03-29): both still overdue
    expect(result.days[6]!.overdue_count).toBe(2);
  });

  it("does not count done/archived todos in overdue_count", () => {
    // Done todo due before the week
    insertRawItem(sqlite, {
      type: "todo",
      title: "Done Todo",
      status: "done",
      due: "2026-03-20",
    });

    // Archived todo due before the week
    insertRawItem(sqlite, {
      type: "todo",
      title: "Archived Todo",
      status: "archived",
      due: "2026-03-20",
    });

    // Active todo due before the week
    insertRawItem(sqlite, {
      type: "todo",
      title: "Active Overdue",
      status: "active",
      due: "2026-03-20",
    });

    const result = getWeekData(sqlite, monday);

    // Only the active todo should count as overdue
    expect(result.days[0]!.overdue_count).toBe(1);
  });

  it("excludes archived todos from todos_due", () => {
    insertRawItem(sqlite, {
      type: "todo",
      title: "Archived Todo",
      status: "archived",
      due: "2026-03-23",
    });

    const result = getWeekData(sqlite, monday);
    expect(result.days[0]!.todos_due).toHaveLength(0);
  });

  it("handles timezone boundary — item created at 23:59 local time", () => {
    // Item created at 23:59 local on Tuesday
    const lateNight = new Date(2026, 2, 24, 23, 59, 0);
    insertRawItem(sqlite, {
      type: "note",
      title: "Late Night Note",
      status: "fleeting",
      created: lateNight.toISOString(),
      modified: lateNight.toISOString(),
    });

    const result = getWeekData(sqlite, monday);

    // Should bucket into Tuesday (index 1), not Wednesday
    expect(result.days[1]!.notes_created).toHaveLength(1);
    expect(result.days[1]!.notes_created[0]!.title).toBe("Late Night Note");
    expect(result.days[2]!.notes_created).toHaveLength(0);
  });

  it("handles mixed data across multiple days", () => {
    // Monday: 1 todo, 1 note created
    insertRawItem(sqlite, {
      type: "todo",
      title: "Todo Mon",
      status: "active",
      due: "2026-03-23",
    });
    const monTime = new Date(2026, 2, 23, 14, 0, 0);
    insertRawItem(sqlite, {
      type: "note",
      title: "Note Mon",
      status: "fleeting",
      created: monTime.toISOString(),
      modified: monTime.toISOString(),
    });

    // Wednesday: 2 todos
    insertRawItem(sqlite, {
      type: "todo",
      title: "Todo Wed 1",
      status: "active",
      due: "2026-03-25",
    });
    insertRawItem(sqlite, {
      type: "todo",
      title: "Todo Wed 2",
      status: "done",
      due: "2026-03-25",
    });

    // Friday: 1 note modified (created before week)
    const beforeWeek = new Date(2026, 2, 10, 12, 0, 0);
    const friTime = new Date(2026, 2, 27, 16, 0, 0);
    insertRawItem(sqlite, {
      type: "note",
      title: "Note Modified Fri",
      status: "developing",
      created: beforeWeek.toISOString(),
      modified: friTime.toISOString(),
    });

    const result = getWeekData(sqlite, monday);

    expect(result.days[0]!.todos_due).toHaveLength(1);
    expect(result.days[0]!.notes_created).toHaveLength(1);

    expect(result.days[2]!.todos_due).toHaveLength(2);

    expect(result.days[4]!.notes_modified).toHaveLength(1);
    expect(result.days[4]!.notes_modified[0]!.title).toBe("Note Modified Fri");
  });

  it("excludes private items from overdue_count", () => {
    // Private overdue todo
    insertRawItem(sqlite, {
      type: "todo",
      title: "Private Overdue",
      status: "active",
      due: "2026-03-20",
      is_private: 1,
    });

    // Public overdue todo
    insertRawItem(sqlite, {
      type: "todo",
      title: "Public Overdue",
      status: "active",
      due: "2026-03-20",
      is_private: 0,
    });

    const result = getWeekData(sqlite, monday);

    // Only public overdue should count
    expect(result.days[0]!.overdue_count).toBe(1);
  });

  it("only includes note type in notes_created and notes_modified", () => {
    const monTime = new Date(2026, 2, 23, 10, 0, 0);

    // A todo created on Monday — should NOT appear in notes_created
    insertRawItem(sqlite, {
      type: "todo",
      title: "Todo Item",
      status: "active",
      created: monTime.toISOString(),
      modified: monTime.toISOString(),
    });

    // A scratch created on Monday — should NOT appear in notes_created
    insertRawItem(sqlite, {
      type: "scratch",
      title: "Scratch Item",
      status: "draft",
      created: monTime.toISOString(),
      modified: monTime.toISOString(),
    });

    // A note created on Monday — should appear
    insertRawItem(sqlite, {
      type: "note",
      title: "Note Item",
      status: "fleeting",
      created: monTime.toISOString(),
      modified: monTime.toISOString(),
    });

    const result = getWeekData(sqlite, monday);
    expect(result.days[0]!.notes_created).toHaveLength(1);
    expect(result.days[0]!.notes_created[0]!.title).toBe("Note Item");
  });
});
