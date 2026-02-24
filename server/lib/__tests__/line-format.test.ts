import { describe, it, expect } from "vitest";
import { formatNumberedList, formatDetail, formatStats } from "../line-format.js";

describe("formatNumberedList", () => {
  it("formats items with index, due date and priority", () => {
    const items = [
      { id: "1", title: "Buy milk", due_date: "2026-03-01", priority: "high" },
      { id: "2", title: "Read book", due_date: null, priority: null },
    ];
    const result = formatNumberedList("📥 收件匣", items, 2);
    expect(result).toContain("📥 收件匣（共 2 筆）");
    expect(result).toContain("[1] Buy milk 📅2026-03-01 ⚡");
    expect(result).toContain("[2] Read book");
  });

  it("shows partial count when total > displayed", () => {
    const items = [{ id: "1", title: "A", due_date: null, priority: null }];
    const result = formatNumberedList("Test", items, 10);
    expect(result).toContain("共 10 筆，顯示 5 筆");
  });
});

describe("formatDetail", () => {
  it("shows all item fields", () => {
    const item = {
      title: "Test item",
      type: "todo",
      status: "active",
      priority: "high",
      due_date: "2026-03-01",
      tags: '["work","urgent"]',
      content: "Some content here",
    };
    const result = formatDetail(item);
    expect(result).toContain("📋 Test item");
    expect(result).toContain("類型：待辦");
    expect(result).toContain("狀態：進行中");
    expect(result).toContain("優先：high");
    expect(result).toContain("到期：2026-03-01");
    expect(result).toContain("標籤：work、urgent");
    expect(result).toContain("Some content here");
  });

  it("truncates long content", () => {
    const item = {
      title: "T",
      type: "note",
      status: "inbox",
      priority: null,
      due_date: null,
      tags: "[]",
      content: "x".repeat(6000),
    };
    const result = formatDetail(item);
    expect(result.length).toBeLessThanOrEqual(5000);
    expect(result).toContain("⋯（已截斷）");
  });
});

describe("formatStats", () => {
  it("formats all stat fields", () => {
    const stats = {
      inbox_count: 5,
      active_count: 3,
      overdue_count: 1,
      completed_this_week: 8,
      completed_this_month: 20,
    };
    const result = formatStats(stats);
    expect(result).toContain("📥 收件匣：5");
    expect(result).toContain("🔵 進行中：3");
    expect(result).toContain("⚠️ 逾期：1");
    expect(result).toContain("✅ 本週完成：8");
    expect(result).toContain("✅ 本月完成：20");
  });
});
