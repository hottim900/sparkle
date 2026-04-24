import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetWeekData = vi.fn();

vi.mock("../../db/index.js", () => ({
  sqlite: {},
}));

vi.mock("../../lib/stats.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/stats.js")>();
  return {
    ...original,
    getWeekData: (...args: unknown[]) => mockGetWeekData(...args),
  };
});

vi.mock("../../lib/settings.js", () => ({
  getDashboardSettings: () => ({ recentDays: 7, staleDays: 7 }),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

import { Hono } from "hono";
import { dashboardRouter } from "../dashboard.js";

function createApp() {
  const app = new Hono();
  app.route("/api/dashboard", dashboardRouter);
  return app;
}

describe("GET /api/dashboard/week", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    mockGetWeekData.mockReset();
    mockGetWeekData.mockReturnValue({
      days: Array.from({ length: 7 }, (_, i) => ({
        date: `2026-03-${23 + i}`,
        todos_due: [],
        notes_created: [],
        notes_modified: [],
        overdue_count: 0,
      })),
    });
    app = createApp();
  });

  it("returns 400 when start param is missing", async () => {
    const res = await app.request("/api/dashboard/week");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("YYYY-MM-DD");
  });

  it("returns 400 when start param has invalid format", async () => {
    const res = await app.request("/api/dashboard/week?start=2026-3-23");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("YYYY-MM-DD");
  });

  it("returns 400 when start is not a real date", async () => {
    const res = await app.request("/api/dashboard/week?start=2026-02-30");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("valid date");
  });

  it("returns 400 when start is not a Monday", async () => {
    // 2026-03-25 is Wednesday
    const res = await app.request("/api/dashboard/week?start=2026-03-25");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Monday");
  });

  it("returns 200 with week data for a valid Monday", async () => {
    // 2026-03-23 is Monday
    const res = await app.request("/api/dashboard/week?start=2026-03-23");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days).toHaveLength(7);
    expect(mockGetWeekData).toHaveBeenCalledWith(expect.anything(), "2026-03-23");
  });
});
