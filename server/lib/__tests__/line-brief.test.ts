import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestDb } from "../../test-utils.js";
import type Database from "better-sqlite3";

// Mock line-format (pushLine)
const mockPushLine = vi.fn();
vi.mock("../line-format.js", () => ({
  pushLine: (...args: unknown[]) => mockPushLine(...args),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  queryBriefData,
  shouldPush,
  formatBriefMessage,
  generateAndPushBrief,
} from "../line-brief.js";

// --- Helpers ---

let sqlite: Database.Database;

function insertItem(overrides: Record<string, unknown> = {}) {
  const defaults = {
    id: crypto.randomUUID(),
    type: "note",
    title: "Test Note",
    content: "",
    status: "fleeting",
    priority: null,
    due: null,
    tags: "[]",
    origin: "web",
    source: null,
    aliases: "[]",
    linked_note_id: null,
    category_id: null,
    viewed_at: null,
    is_private: 0,
    created: "2026-03-24T10:00:00.000Z",
    modified: "2026-03-24T10:00:00.000Z",
  };
  const item = { ...defaults, ...overrides };
  sqlite
    .prepare(
      `INSERT INTO items_active (id, type, title, content, status, priority, due, tags, origin, source, aliases, linked_note_id, category_id, viewed_at, is_private, created, modified)
       VALUES (@id, @type, @title, @content, @status, @priority, @due, @tags, @origin, @source, @aliases, @linked_note_id, @category_id, @viewed_at, @is_private, @created, @modified)`,
    )
    .run(item);
  return item;
}

// --- Setup ---

beforeEach(() => {
  const testDb = createTestDb();
  sqlite = testDb.sqlite;
  mockPushLine.mockReset();
});

afterEach(() => {
  sqlite.close();
});

// ============================================================
// queryBriefData
// ============================================================
describe("queryBriefData", () => {
  it("returns empty data when no items exist", () => {
    const data = queryBriefData(sqlite, "2026-03-24");
    expect(data.overdue_todos).toEqual([]);
    expect(data.stale_fleetings).toEqual([]);
    expect(data.notes_created_count).toBe(0);
    expect(data.notes_modified_count).toBe(0);
    expect(data.todos_due_count).toBe(0);
    expect(data.todos_done_count).toBe(0);
    expect(data.total_activity).toBe(0);
  });

  it("counts notes created on the target date", () => {
    // Use local day boundaries for reliable cross-timezone testing
    const dayStart = new Date(2026, 2, 24, 0, 0, 0).toISOString();
    const dayMid = new Date(2026, 2, 24, 12, 0, 0).toISOString();
    const prevDay = new Date(2026, 2, 23, 12, 0, 0).toISOString();

    insertItem({ created: dayStart, modified: dayStart });
    insertItem({ created: dayMid, modified: dayMid });
    // Different day — should not count
    insertItem({ created: prevDay, modified: prevDay });

    const data = queryBriefData(sqlite, "2026-03-24");
    expect(data.notes_created_count).toBe(2);
  });

  it("counts notes modified on the target date (excluding same-day created)", () => {
    // Created yesterday, modified today → counts as modified
    insertItem({ created: "2026-03-23T08:00:00.000Z", modified: "2026-03-24T14:00:00.000Z" });
    // Created today, modified today → does NOT count as modified (avoids double-count)
    insertItem({ created: "2026-03-24T08:00:00.000Z", modified: "2026-03-24T14:00:00.000Z" });

    const data = queryBriefData(sqlite, "2026-03-24");
    expect(data.notes_modified_count).toBe(1);
    expect(data.notes_created_count).toBe(1); // the second item
  });

  it("finds overdue todos", () => {
    insertItem({
      type: "todo",
      title: "Overdue task",
      status: "active",
      due: "2026-03-20",
    });
    // Done todo should not appear
    insertItem({
      type: "todo",
      title: "Done task",
      status: "done",
      due: "2026-03-20",
    });

    const data = queryBriefData(sqlite, "2026-03-24");
    expect(data.overdue_todos).toHaveLength(1);
    expect(data.overdue_todos[0]!.title).toBe("Overdue task");
  });

  it("finds stale fleeting notes (>7 days)", () => {
    // Use local boundaries so julianday diff is reliable
    const oldDate = new Date(2026, 2, 10, 0, 0, 0).toISOString();
    const recentDate = new Date(2026, 2, 20, 0, 0, 0).toISOString();

    insertItem({
      title: "Old thought",
      status: "fleeting",
      created: oldDate,
      modified: oldDate,
    });
    // Recent fleeting — should not appear
    insertItem({
      title: "Fresh thought",
      status: "fleeting",
      created: recentDate,
      modified: recentDate,
    });

    const data = queryBriefData(sqlite, "2026-03-24");
    expect(data.stale_fleetings).toHaveLength(1);
    expect(data.stale_fleetings[0]!.title).toBe("Old thought");
    expect(data.stale_fleetings[0]!.days_stale).toBeGreaterThanOrEqual(13);
  });

  it("counts todos due on the target date", () => {
    insertItem({ type: "todo", status: "active", due: "2026-03-24" });
    insertItem({ type: "todo", status: "active", due: "2026-03-25" }); // wrong day

    const data = queryBriefData(sqlite, "2026-03-24");
    expect(data.todos_due_count).toBe(1);
  });

  it("counts todos done today", () => {
    insertItem({
      type: "todo",
      status: "done",
      due: "2026-03-24",
      modified: "2026-03-24T15:00:00.000Z",
    });

    const data = queryBriefData(sqlite, "2026-03-24");
    expect(data.todos_done_count).toBe(1);
  });

  it("excludes private items", () => {
    insertItem({
      type: "todo",
      title: "Private overdue",
      status: "active",
      due: "2026-03-20",
      is_private: 1,
    });
    insertItem({
      title: "Private note",
      status: "fleeting",
      is_private: 1,
      created: "2026-03-24T10:00:00.000Z",
      modified: "2026-03-24T10:00:00.000Z",
    });

    const data = queryBriefData(sqlite, "2026-03-24");
    expect(data.overdue_todos).toHaveLength(0);
    expect(data.notes_created_count).toBe(0);
  });
});

// ============================================================
// shouldPush
// ============================================================
describe("shouldPush", () => {
  const emptyData = {
    date: "2026-03-24",
    overdue_todos: [],
    stale_fleetings: [],
    notes_created_count: 0,
    notes_modified_count: 0,
    todos_due_count: 0,
    todos_done_count: 0,
    total_activity: 0,
  };

  it("pushes when there are overdue todos", () => {
    const result = shouldPush({
      ...emptyData,
      overdue_todos: [{ id: "1", title: "Task", due: "2026-03-20", priority: null }],
    });
    expect(result.push).toBe(true);
    expect(result.reason).toBe("overdue_todos");
  });

  it("pushes when there are stale fleetings", () => {
    const result = shouldPush({
      ...emptyData,
      stale_fleetings: [{ id: "1", title: "Old idea", days_stale: 10 }],
    });
    expect(result.push).toBe(true);
    expect(result.reason).toBe("stale_fleetings");
  });

  it("pushes when total_activity >= 3", () => {
    const result = shouldPush({
      ...emptyData,
      notes_created_count: 2,
      todos_done_count: 1,
      total_activity: 3,
    });
    expect(result.push).toBe(true);
    expect(result.reason).toBe("activity_summary");
  });

  it("does not push on quiet days", () => {
    const result = shouldPush(emptyData);
    expect(result.push).toBe(false);
  });

  it("does not push when activity < 3 and no overdue/stale", () => {
    const result = shouldPush({
      ...emptyData,
      notes_created_count: 1,
      total_activity: 1,
    });
    expect(result.push).toBe(false);
  });
});

// ============================================================
// formatBriefMessage
// ============================================================
describe("formatBriefMessage", () => {
  it("formats a complete brief", () => {
    const msg = formatBriefMessage({
      date: "2026-03-24",
      overdue_todos: [{ id: "1", title: "Fix bug", due: "2026-03-22", priority: "high" }],
      stale_fleetings: [{ id: "2", title: "Old idea", days_stale: 10 }],
      notes_created_count: 2,
      notes_modified_count: 1,
      todos_due_count: 3,
      todos_done_count: 1,
      total_activity: 7,
    });

    expect(msg).toContain("Sparkle 每日簡報");
    expect(msg).toContain("3月24日");
    expect(msg).toContain("捕捉 2 個新想法");
    expect(msg).toContain("推進 1 篇筆記");
    expect(msg).toContain("1 完成");
    expect(msg).toContain("3 待處理");
    expect(msg).toContain("逾期：1 項");
    expect(msg).toContain("Fix bug");
    expect(msg).toContain("⚡");
    expect(msg).toContain("Old idea");
    expect(msg).toContain("10 天前");
  });

  it("shows no overdue when none exist", () => {
    const msg = formatBriefMessage({
      date: "2026-03-24",
      overdue_todos: [],
      stale_fleetings: [],
      notes_created_count: 3,
      notes_modified_count: 0,
      todos_due_count: 0,
      todos_done_count: 0,
      total_activity: 3,
    });

    expect(msg).toContain("逾期：無");
    expect(msg).not.toContain("閃念放了");
  });

  it("truncates overdue list at 3 items", () => {
    const overdue = Array.from({ length: 5 }, (_, i) => ({
      id: String(i),
      title: `Task ${i}`,
      due: "2026-03-20",
      priority: null,
    }));

    const msg = formatBriefMessage({
      date: "2026-03-24",
      overdue_todos: overdue,
      stale_fleetings: [],
      notes_created_count: 0,
      notes_modified_count: 0,
      todos_due_count: 0,
      todos_done_count: 0,
      total_activity: 0,
    });

    expect(msg).toContain("Task 0");
    expect(msg).toContain("Task 2");
    expect(msg).not.toContain("Task 3");
    expect(msg).toContain("還有 2 項");
  });
});

// ============================================================
// generateAndPushBrief
// ============================================================
describe("generateAndPushBrief", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("skips when LINE_CHANNEL_ACCESS_TOKEN is not set", async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const result = await generateAndPushBrief(sqlite, "2026-03-24");
    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("LINE_CHANNEL_ACCESS_TOKEN");
  });

  it("skips when LINE_ALLOWED_USER_IDS is not set", async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
    delete process.env.LINE_ALLOWED_USER_IDS;
    const result = await generateAndPushBrief(sqlite, "2026-03-24");
    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("LINE_ALLOWED_USER_IDS");
  });

  it("skips on quiet days (no actionable items)", async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
    process.env.LINE_ALLOWED_USER_IDS = "user1";

    const result = await generateAndPushBrief(sqlite, "2026-03-24");
    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("quiet day");
  });

  it("pushes when there are overdue todos", async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
    process.env.LINE_ALLOWED_USER_IDS = "user1,user2";
    mockPushLine.mockResolvedValue(true);

    insertItem({ type: "todo", status: "active", due: "2026-03-20", title: "Overdue" });

    const result = await generateAndPushBrief(sqlite, "2026-03-24");
    expect(result.sent).toBe(true);
    expect(result.message).toContain("Sparkle 每日簡報");
    expect(mockPushLine).toHaveBeenCalledTimes(2); // both users
    expect(mockPushLine).toHaveBeenCalledWith("test-token", "user1", expect.any(String));
    expect(mockPushLine).toHaveBeenCalledWith("test-token", "user2", expect.any(String));
  });

  it("returns sent=false when all pushes fail", async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
    process.env.LINE_ALLOWED_USER_IDS = "user1";
    mockPushLine.mockResolvedValue(false);

    insertItem({ type: "todo", status: "active", due: "2026-03-20", title: "Overdue" });

    const result = await generateAndPushBrief(sqlite, "2026-03-24");
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("All push attempts failed");
  });
});
