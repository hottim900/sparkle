import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// --- Mocks ---

const mockGetLineBriefSettings = vi.fn();
const mockGetSetting = vi.fn();
const mockUpdateSettings = vi.fn();
const mockGenerateAndPushBrief = vi.fn();

vi.mock("../settings.js", () => ({
  getLineBriefSettings: (...args: unknown[]) => mockGetLineBriefSettings(...args),
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
}));

vi.mock("../line-brief.js", () => ({
  generateAndPushBrief: (...args: unknown[]) => mockGenerateAndPushBrief(...args),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Must import after mocks
import { checkAndSendLineBrief } from "../line-brief-scheduler.js";

// --- Helpers ---

function setTime(hh: string, mm: string) {
  vi.setSystemTime(new Date(2026, 2, 24, parseInt(hh), parseInt(mm), 0));
}

// --- Setup ---

beforeEach(() => {
  vi.useFakeTimers();
  mockGetLineBriefSettings.mockReset();
  mockGetSetting.mockReset();
  mockUpdateSettings.mockReset();
  mockGenerateAndPushBrief.mockReset();

  mockGetLineBriefSettings.mockReturnValue({
    line_brief_enabled: true,
    line_brief_time: "21:00",
  });
  mockGetSetting.mockReturnValue(null); // no last_brief_sent_date

  // LINE env vars
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-token";
  process.env.LINE_ALLOWED_USER_IDS = "user1";
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  delete process.env.LINE_ALLOWED_USER_IDS;
});

const fakeSqlite = {} as never;

// ============================================================
// Early returns
// ============================================================
describe("checkAndSendLineBrief — early returns", () => {
  it("returns early when line_brief_enabled is false", () => {
    mockGetLineBriefSettings.mockReturnValue({
      line_brief_enabled: false,
      line_brief_time: "21:00",
    });

    checkAndSendLineBrief(fakeSqlite);
    expect(mockGenerateAndPushBrief).not.toHaveBeenCalled();
  });

  it("returns early when LINE_CHANNEL_ACCESS_TOKEN is not set", () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;

    checkAndSendLineBrief(fakeSqlite);
    expect(mockGenerateAndPushBrief).not.toHaveBeenCalled();
  });

  it("returns early when LINE_ALLOWED_USER_IDS is not set", () => {
    delete process.env.LINE_ALLOWED_USER_IDS;

    checkAndSendLineBrief(fakeSqlite);
    expect(mockGenerateAndPushBrief).not.toHaveBeenCalled();
  });

  it("returns early when current time is before line_brief_time", () => {
    setTime("20", "59");

    checkAndSendLineBrief(fakeSqlite);
    expect(mockGenerateAndPushBrief).not.toHaveBeenCalled();
  });

  it("returns early when already sent today", () => {
    setTime("21", "01");
    mockGetSetting.mockReturnValue("2026-03-24");

    checkAndSendLineBrief(fakeSqlite);
    expect(mockGenerateAndPushBrief).not.toHaveBeenCalled();
  });
});

// ============================================================
// Successful send
// ============================================================
describe("checkAndSendLineBrief — send", () => {
  it("sends and records last_brief_sent_date on success", async () => {
    setTime("21", "01");
    mockGenerateAndPushBrief.mockResolvedValue({ sent: true, message: "test" });

    checkAndSendLineBrief(fakeSqlite);

    await vi.waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith(fakeSqlite, {
        last_brief_sent_date: "2026-03-24",
      });
    });
  });

  it("records date when skipped (quiet day)", async () => {
    setTime("21", "01");
    mockGenerateAndPushBrief.mockResolvedValue({
      sent: false,
      skipped: true,
      reason: "No actionable items",
    });

    checkAndSendLineBrief(fakeSqlite);

    await vi.waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith(fakeSqlite, {
        last_brief_sent_date: "2026-03-24",
      });
    });
  });

  it("does NOT record date when push fails (allows retry)", async () => {
    setTime("21", "01");
    mockGenerateAndPushBrief.mockResolvedValue({
      sent: false,
      reason: "All push attempts failed",
    });

    checkAndSendLineBrief(fakeSqlite);

    // Wait for promise to settle
    await vi.waitFor(() => {
      // Should not have updated the date
      expect(mockUpdateSettings).not.toHaveBeenCalled();
    });
  });

  it("triggers at exact line_brief_time", async () => {
    setTime("21", "00");
    mockGenerateAndPushBrief.mockResolvedValue({ sent: true, message: "test" });

    checkAndSendLineBrief(fakeSqlite);

    await vi.waitFor(() => {
      expect(mockGenerateAndPushBrief).toHaveBeenCalledWith(fakeSqlite, "2026-03-24");
    });
  });
});

// ============================================================
// Concurrency guard
// ============================================================
describe("checkAndSendLineBrief — concurrency guard", () => {
  it("prevents double-fire while sending", async () => {
    setTime("21", "01");

    let resolveGenerate!: (v: unknown) => void;
    mockGenerateAndPushBrief.mockReturnValue(
      new Promise((resolve) => {
        resolveGenerate = resolve;
      }),
    );

    // First call starts sending
    checkAndSendLineBrief(fakeSqlite);
    expect(mockGenerateAndPushBrief).toHaveBeenCalledTimes(1);

    // Second call while first is still pending — blocked
    checkAndSendLineBrief(fakeSqlite);
    expect(mockGenerateAndPushBrief).toHaveBeenCalledTimes(1);

    // Resolve the first call
    resolveGenerate({ sent: true, message: "test" });

    await vi.waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalled();
    });
  });
});

// ============================================================
// Error handling
// ============================================================
describe("checkAndSendLineBrief — error handling", () => {
  it("resets sending flag on error, allows retry", async () => {
    setTime("21", "01");
    mockGenerateAndPushBrief.mockRejectedValue(new Error("network error"));

    checkAndSendLineBrief(fakeSqlite);
    expect(mockGenerateAndPushBrief).toHaveBeenCalledTimes(1);

    // Wait for finally() to reset the flag
    mockGenerateAndPushBrief.mockResolvedValue({ sent: true, message: "ok" });

    await vi.waitFor(() => {
      checkAndSendLineBrief(fakeSqlite);
      expect(mockGenerateAndPushBrief).toHaveBeenCalledTimes(2);
    });

    // Error case should not have recorded the date
    await vi.waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
    });
  });
});
