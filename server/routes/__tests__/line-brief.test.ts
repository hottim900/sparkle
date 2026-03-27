import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mocks ---

const mockGenerateAndPushBrief = vi.fn();
const mockUpdateSettings = vi.fn();
const mockToLocalDateStr = vi.fn();

vi.mock("../../db/index.js", () => ({
  sqlite: {},
}));

vi.mock("../../lib/line-brief.js", () => ({
  generateAndPushBrief: (...args: unknown[]) => mockGenerateAndPushBrief(...args),
}));

vi.mock("../../lib/settings.js", () => ({
  updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
}));

vi.mock("../../lib/stats.js", () => ({
  toLocalDateStr: (...args: unknown[]) => mockToLocalDateStr(...args),
}));

vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { Hono } from "hono";
import { lineBriefRouter } from "../line-brief.js";

function createApp() {
  const app = new Hono();
  app.route("/api/line-brief", lineBriefRouter);
  return app;
}

// --- Setup ---

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  mockGenerateAndPushBrief.mockReset();
  mockUpdateSettings.mockReset();
  mockToLocalDateStr.mockReset();
  mockToLocalDateStr.mockReturnValue("2026-03-26");
  app = createApp();
});

// ============================================================
// POST /api/line-brief/send
// ============================================================
describe("POST /api/line-brief/send", () => {
  it("sends brief for today (no date param)", async () => {
    mockGenerateAndPushBrief.mockResolvedValue({
      sent: true,
      message: "📊 test brief",
    });

    const res = await app.request("/api/line-brief/send", { method: "POST" });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sent).toBe(true);
    expect(body.message).toBe("📊 test brief");
    expect(mockGenerateAndPushBrief).toHaveBeenCalledWith({}, undefined);
  });

  it("sends brief for specific date", async () => {
    mockGenerateAndPushBrief.mockResolvedValue({
      sent: true,
      message: "📊 brief for 3/20",
    });

    const res = await app.request("/api/line-brief/send?date=2026-03-20", {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sent).toBe(true);
    expect(mockGenerateAndPushBrief).toHaveBeenCalledWith({}, "2026-03-20");
  });

  it("returns 400 for invalid date format", async () => {
    const res = await app.request("/api/line-brief/send?date=2026-3-20", {
      method: "POST",
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("Invalid date format");
    expect(mockGenerateAndPushBrief).not.toHaveBeenCalled();
  });

  it("returns 400 for semantically invalid date (month 99)", async () => {
    const res = await app.request("/api/line-brief/send?date=2026-99-01", {
      method: "POST",
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("Invalid date");
    expect(mockGenerateAndPushBrief).not.toHaveBeenCalled();
  });

  it("updates last_brief_sent_date when sending for today", async () => {
    mockToLocalDateStr.mockReturnValue("2026-03-26");
    mockGenerateAndPushBrief.mockResolvedValue({
      sent: true,
      message: "brief",
    });

    await app.request("/api/line-brief/send", { method: "POST" });

    expect(mockUpdateSettings).toHaveBeenCalledWith({}, { last_brief_sent_date: "2026-03-26" });
  });

  it("updates last_brief_sent_date when date param matches today", async () => {
    mockToLocalDateStr.mockReturnValue("2026-03-26");
    mockGenerateAndPushBrief.mockResolvedValue({
      sent: true,
      message: "brief",
    });

    await app.request("/api/line-brief/send?date=2026-03-26", { method: "POST" });

    expect(mockUpdateSettings).toHaveBeenCalledWith({}, { last_brief_sent_date: "2026-03-26" });
  });

  it("does NOT update last_brief_sent_date when sending for a past date", async () => {
    mockToLocalDateStr.mockReturnValue("2026-03-26");
    mockGenerateAndPushBrief.mockResolvedValue({
      sent: true,
      message: "brief",
    });

    await app.request("/api/line-brief/send?date=2026-03-20", { method: "POST" });

    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("does NOT update last_brief_sent_date when brief was not sent", async () => {
    mockGenerateAndPushBrief.mockResolvedValue({
      sent: false,
      skipped: true,
      reason: "No actionable items (quiet day)",
    });

    await app.request("/api/line-brief/send", { method: "POST" });

    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("returns skipped result correctly", async () => {
    mockGenerateAndPushBrief.mockResolvedValue({
      sent: false,
      skipped: true,
      reason: "LINE_CHANNEL_ACCESS_TOKEN not set",
    });

    const res = await app.request("/api/line-brief/send", { method: "POST" });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sent).toBe(false);
    expect(body.skipped).toBe(true);
    expect(body.reason).toContain("LINE_CHANNEL_ACCESS_TOKEN");
  });

  it("returns 500 when generateAndPushBrief throws", async () => {
    mockGenerateAndPushBrief.mockRejectedValue(new Error("network error"));

    const res = await app.request("/api/line-brief/send", { method: "POST" });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toContain("Failed to send LINE brief");
  });
});
