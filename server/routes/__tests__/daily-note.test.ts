import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mocks ---

const mockGenerateDailyNote = vi.fn();
const mockUpdateSettings = vi.fn();
const mockToLocalDateStr = vi.fn();

vi.mock("../../db/index.js", () => ({
  sqlite: {},
}));

vi.mock("../../lib/daily-note.js", () => ({
  generateDailyNote: (...args: unknown[]) => mockGenerateDailyNote(...args),
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
import { dailyNoteRouter } from "../daily-note.js";

function createApp() {
  const app = new Hono();
  app.route("/api/daily-note", dailyNoteRouter);
  return app;
}

// --- Setup ---

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  mockGenerateDailyNote.mockReset();
  mockUpdateSettings.mockReset();
  mockToLocalDateStr.mockReset();
  mockToLocalDateStr.mockReturnValue("2026-03-24");
  app = createApp();
});

// ============================================================
// POST /api/daily-note/generate
// ============================================================
describe("POST /api/daily-note/generate", () => {
  it("generates daily note for today (no date param)", async () => {
    mockGenerateDailyNote.mockResolvedValue({
      date: "2026-03-24",
      path: "Daily/Sparkle/2026-03-24.md",
    });

    const res = await app.request("/api/daily-note/generate", { method: "POST" });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.date).toBe("2026-03-24");
    expect(body.path).toBe("Daily/Sparkle/2026-03-24.md");
    expect(mockGenerateDailyNote).toHaveBeenCalledWith({}, undefined);
  });

  it("generates daily note for specific date", async () => {
    mockGenerateDailyNote.mockResolvedValue({
      date: "2026-03-20",
      path: "Daily/Sparkle/2026-03-20.md",
    });

    const res = await app.request("/api/daily-note/generate?date=2026-03-20", {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.date).toBe("2026-03-20");
    expect(mockGenerateDailyNote).toHaveBeenCalledWith({}, "2026-03-20");
  });

  it("returns 400 for invalid date format", async () => {
    const res = await app.request("/api/daily-note/generate?date=2026-3-20", {
      method: "POST",
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("Invalid date format");
    expect(mockGenerateDailyNote).not.toHaveBeenCalled();
  });

  it("returns 400 for semantically invalid date (month 99)", async () => {
    const res = await app.request("/api/daily-note/generate?date=2026-99-01", {
      method: "POST",
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("Invalid date");
    expect(mockGenerateDailyNote).not.toHaveBeenCalled();
  });

  it("returns 400 for semantically invalid date (Feb 30)", async () => {
    const res = await app.request("/api/daily-note/generate?date=2026-02-30", {
      method: "POST",
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("Invalid date");
    expect(mockGenerateDailyNote).not.toHaveBeenCalled();
  });

  it("returns 400 for semantically invalid date (day 00)", async () => {
    const res = await app.request("/api/daily-note/generate?date=2026-03-00", {
      method: "POST",
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("Invalid date");
    expect(mockGenerateDailyNote).not.toHaveBeenCalled();
  });

  it("updates last_daily_note_date when generating for today", async () => {
    mockToLocalDateStr.mockReturnValue("2026-03-24");
    mockGenerateDailyNote.mockResolvedValue({
      date: "2026-03-24",
      path: "Daily/Sparkle/2026-03-24.md",
    });

    await app.request("/api/daily-note/generate", { method: "POST" });

    expect(mockUpdateSettings).toHaveBeenCalledWith(
      {},
      {
        last_daily_note_date: "2026-03-24",
      },
    );
  });

  it("does NOT update last_daily_note_date when generating for a past date", async () => {
    mockToLocalDateStr.mockReturnValue("2026-03-24");
    mockGenerateDailyNote.mockResolvedValue({
      date: "2026-03-20",
      path: "Daily/Sparkle/2026-03-20.md",
    });

    await app.request("/api/daily-note/generate?date=2026-03-20", { method: "POST" });

    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("does NOT update last_daily_note_date when result is skipped", async () => {
    mockToLocalDateStr.mockReturnValue("2026-03-24");
    mockGenerateDailyNote.mockResolvedValue({
      date: "2026-03-24",
      path: "",
      skipped: true,
      reason: "No activity",
    });

    await app.request("/api/daily-note/generate", { method: "POST" });

    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("returns 500 when generateDailyNote throws", async () => {
    mockGenerateDailyNote.mockRejectedValue(new Error("disk full"));

    const res = await app.request("/api/daily-note/generate", { method: "POST" });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toContain("Failed to generate");
  });
});
