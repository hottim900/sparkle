import { describe, it, expect } from "vitest";
import { formatItem, formatItemList, formatStats, formatTags } from "../format.js";
import { makeItem, makeStats } from "./helpers.js";

describe("formatItem", () => {
  it("formats a basic note with minimal fields", () => {
    const item = makeItem({ title: "My Note", status: "fleeting", content: "" });
    const result = formatItem(item);
    expect(result).toContain("# My Note");
    expect(result).toContain("**Status**: fleeting");
    expect(result).toContain("Type: note");
  });

  it("formats a note with all fields populated", () => {
    const item = makeItem({
      title: "Full Note",
      status: "developing",
      content: "Detailed content here.",
      tags: '["ai","ml"]',
      aliases: '["artificial intelligence","AI"]',
      priority: "high",
      due: "2026-03-01",
      source: "https://example.com",
      origin: "LINE",
    });
    const result = formatItem(item);
    expect(result).toContain("# Full Note");
    expect(result).toContain("**Status**: developing");
    expect(result).toContain("**Tags**: ai, ml");
    expect(result).toContain("**Priority**: high");
    expect(result).toContain("**Due**: 2026-03-01");
    expect(result).toContain("**Aliases**: artificial intelligence, AI");
    expect(result).toContain("**Source**: https://example.com");
    expect(result).toContain("Detailed content here.");
    expect(result).toContain("Origin: LINE");
  });

  it("formats a todo with linked_note_title", () => {
    const item = makeItem({
      type: "todo",
      title: "Follow up task",
      status: "active",
      linked_note_title: "Related Research",
    });
    const result = formatItem(item);
    expect(result).toContain("Linked note: Related Research");
    expect(result).toContain("Type: todo");
  });

  it("formats a note with linked_todo_count > 0", () => {
    const item = makeItem({
      title: "Research Note",
      linked_todo_count: 3,
    });
    const result = formatItem(item);
    expect(result).toContain("Linked todos: 3");
  });

  it("does not show linked_todo_count for todos", () => {
    const item = makeItem({
      type: "todo",
      status: "active",
      linked_todo_count: 5,
    });
    const result = formatItem(item);
    expect(result).not.toContain("Linked todos:");
  });

  it("does not show linked_note_title for notes", () => {
    const item = makeItem({
      type: "note",
      linked_note_title: "Should Not Show",
    });
    const result = formatItem(item);
    expect(result).not.toContain("Linked note:");
  });

  it("shows share_visibility when present", () => {
    const item = makeItem({ share_visibility: "public" });
    const result = formatItem(item);
    expect(result).toContain("Shared: public");
  });

  it("does not show shared when share_visibility is null", () => {
    const item = makeItem({ share_visibility: null });
    const result = formatItem(item);
    expect(result).not.toContain("Shared:");
  });

  it("handles invalid JSON in tags gracefully", () => {
    const item = makeItem({ tags: "not-json" });
    const result = formatItem(item);
    // Should not throw, tags just won't appear
    expect(result).toContain("# Test Note");
    expect(result).not.toContain("**Tags**:");
  });
});

describe("formatItemList", () => {
  it("returns 'No items found.' for empty list", () => {
    expect(formatItemList([], 0)).toBe("No items found.");
  });

  it("formats list with items showing count", () => {
    const items = [
      makeItem({ title: "Note A", status: "fleeting" }),
      makeItem({ title: "Note B", status: "developing" }),
    ];
    const result = formatItemList(items, 5);
    expect(result).toContain("Found 5 items (showing 2):");
    expect(result).toContain("**Note A** — fleeting");
    expect(result).toContain("**Note B** — developing");
  });

  it("includes tags, priority, and due in list items", () => {
    const items = [
      makeItem({
        title: "Todo",
        type: "todo",
        status: "active",
        tags: '["urgent"]',
        priority: "high",
        due: "2026-02-28",
      }),
    ];
    const result = formatItemList(items, 1);
    expect(result).toContain("[urgent]");
    expect(result).toContain("high");
    expect(result).toContain("(due: 2026-02-28)");
  });
});

describe("formatStats", () => {
  it("renders all stat fields", () => {
    const stats = makeStats({
      fleeting_count: 10,
      developing_count: 5,
      permanent_count: 20,
      exported_this_week: 2,
      exported_this_month: 8,
      active_count: 15,
      overdue_count: 3,
      done_this_week: 4,
      done_this_month: 12,
      created_this_week: 7,
      created_this_month: 25,
    });
    const result = formatStats(stats);
    expect(result).toContain("Fleeting: **10**");
    expect(result).toContain("Developing: **5**");
    expect(result).toContain("Permanent: **20**");
    expect(result).toContain("Exported this week: 2 | this month: 8");
    expect(result).toContain("Active: **15**");
    expect(result).toContain("Overdue: **3**");
    expect(result).toContain("Done this week: 4 | this month: 12");
    expect(result).toContain("Created this week: 7 | this month: 25");
  });
});

describe("formatTags", () => {
  it("returns 'No tags found.' for empty array", () => {
    expect(formatTags([])).toBe("No tags found.");
  });

  it("renders tags as bullet list with count", () => {
    const result = formatTags(["ai", "ml", "research"]);
    expect(result).toContain("Found 3 tags:");
    expect(result).toContain("- ai");
    expect(result).toContain("- ml");
    expect(result).toContain("- research");
  });
});
