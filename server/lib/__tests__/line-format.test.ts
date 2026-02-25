import { describe, it, expect } from "vitest";
import { formatNumberedList, formatDetail, formatStats } from "../line-format.js";

describe("formatNumberedList", () => {
  it("formats items with index, due date and priority", () => {
    const items = [
      { id: "1", title: "Buy milk", due: "2026-03-01", priority: "high" },
      { id: "2", title: "Read book", due: null, priority: null },
    ];
    const result = formatNumberedList("📥 收件匣", items, 2);
    expect(result).toContain("📥 收件匣（共 2 筆）");
    expect(result).toContain("[1] Buy milk 📅2026-03-01 ⚡");
    expect(result).toContain("[2] Read book");
  });

  it("shows partial count when total > displayed", () => {
    const items = [{ id: "1", title: "A", due: null, priority: null }];
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
      due: "2026-03-01",
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

  it("shows scratch type as 暫存", () => {
    const item = {
      title: "temp note",
      type: "scratch",
      status: "draft",
      priority: null,
      due: null,
      tags: "[]",
      content: "some content",
    };
    const result = formatDetail(item);
    expect(result).toContain("類型：暫存");
    expect(result).toContain("狀態：暫存");
  });

  it("truncates long content", () => {
    const item = {
      title: "T",
      type: "note",
      status: "fleeting",
      priority: null,
      due: null,
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
      fleeting_count: 5,
      developing_count: 3,
      permanent_count: 2,
      exported_this_week: 1,
      exported_this_month: 4,
      active_count: 8,
      done_this_week: 3,
      done_this_month: 12,
      scratch_count: 4,
      created_this_week: 6,
      created_this_month: 15,
      overdue_count: 2,
    };
    const result = formatStats(stats);
    expect(result).toContain("Sparkle 統計");
    expect(result).toContain("閃念: 5");
    expect(result).toContain("發展中: 3");
    expect(result).toContain("永久: 2");
    expect(result).toContain("進行中: 8");
    expect(result).toContain("本週完成: 3");
    expect(result).toContain("本月完成: 12");
    expect(result).toContain("暫存: 4");
    expect(result).toContain("逾期: 2");
  });
});
