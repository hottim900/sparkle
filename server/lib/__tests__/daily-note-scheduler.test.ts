import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// --- Mocks ---

const mockGetObsidianSettings = vi.fn();
const mockGetDailyNoteSettings = vi.fn();
const mockGetSetting = vi.fn();
const mockUpdateSettings = vi.fn();
const mockGenerateDailyNote = vi.fn();

vi.mock("../settings.js", () => ({
  getObsidianSettings: (...args: unknown[]) => mockGetObsidianSettings(...args),
  getDailyNoteSettings: (...args: unknown[]) => mockGetDailyNoteSettings(...args),
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
}));

vi.mock("../daily-note.js", () => ({
  generateDailyNote: (...args: unknown[]) => mockGenerateDailyNote(...args),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Must import after mocks
import { checkAndGenerateDailyNote } from "../daily-note-scheduler.js";

// --- Helpers ---

function enableObsidian() {
  mockGetObsidianSettings.mockReturnValue({
    obsidian_enabled: true,
    obsidian_vault_path: "/vault",
  });
}

function setTime(hh: string, mm: string) {
  vi.setSystemTime(new Date(2026, 2, 24, parseInt(hh), parseInt(mm), 0));
}

// --- Setup ---

beforeEach(() => {
  vi.useFakeTimers();
  mockGetObsidianSettings.mockReset();
  mockGetDailyNoteSettings.mockReset();
  mockGetSetting.mockReset();
  mockUpdateSettings.mockReset();
  mockGenerateDailyNote.mockReset();

  enableObsidian();
  mockGetDailyNoteSettings.mockReturnValue({
    daily_note_enabled: true,
    obsidian_daily_folder: "Daily",
    daily_note_time: "23:00",
    daily_note_mode: "subfolder",
  });
  mockGetSetting.mockReturnValue(null); // no last_daily_note_date
});

afterEach(() => {
  vi.useRealTimers();
});

const fakeSqlite = {} as never;

// ============================================================
// Early returns
// ============================================================
describe("checkAndGenerateDailyNote — early returns", () => {
  it("returns early when obsidian is disabled", () => {
    mockGetObsidianSettings.mockReturnValue({
      obsidian_enabled: false,
      obsidian_vault_path: "/vault",
    });

    checkAndGenerateDailyNote(fakeSqlite);
    expect(mockGenerateDailyNote).not.toHaveBeenCalled();
  });

  it("returns early when vault path is empty", () => {
    mockGetObsidianSettings.mockReturnValue({
      obsidian_enabled: true,
      obsidian_vault_path: "",
    });

    checkAndGenerateDailyNote(fakeSqlite);
    expect(mockGenerateDailyNote).not.toHaveBeenCalled();
  });

  it("returns early when daily_note_enabled is false", () => {
    mockGetDailyNoteSettings.mockReturnValue({
      daily_note_enabled: false,
      obsidian_daily_folder: "Daily",
      daily_note_time: "23:00",
      daily_note_mode: "subfolder",
    });

    setTime("23", "01");
    checkAndGenerateDailyNote(fakeSqlite);
    expect(mockGenerateDailyNote).not.toHaveBeenCalled();
  });

  it("returns early when current time is before daily_note_time", () => {
    setTime("22", "59");

    checkAndGenerateDailyNote(fakeSqlite);
    expect(mockGenerateDailyNote).not.toHaveBeenCalled();
  });

  it("returns early when already generated today", () => {
    setTime("23", "01");
    mockGetSetting.mockReturnValue("2026-03-24"); // already done today

    checkAndGenerateDailyNote(fakeSqlite);
    expect(mockGenerateDailyNote).not.toHaveBeenCalled();
  });
});

// ============================================================
// Successful generation
// ============================================================
describe("checkAndGenerateDailyNote — generation", () => {
  it("generates and updates last_daily_note_date on success", async () => {
    setTime("23", "01");
    mockGenerateDailyNote.mockResolvedValue({
      date: "2026-03-24",
      path: "Daily/Sparkle/2026-03-24.md",
    });

    checkAndGenerateDailyNote(fakeSqlite);

    // Wait for the async chain to resolve
    await vi.waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith(fakeSqlite, {
        last_daily_note_date: "2026-03-24",
      });
    });
  });

  it("still updates setting when generation is skipped", async () => {
    setTime("23", "01");
    mockGenerateDailyNote.mockResolvedValue({
      date: "2026-03-24",
      path: "",
      skipped: true,
      reason: "No activity",
    });

    checkAndGenerateDailyNote(fakeSqlite);

    await vi.waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith(fakeSqlite, {
        last_daily_note_date: "2026-03-24",
      });
    });
  });

  it("triggers at exact daily_note_time", async () => {
    setTime("23", "00");
    mockGenerateDailyNote.mockResolvedValue({
      date: "2026-03-24",
      path: "Daily/Sparkle/2026-03-24.md",
    });

    checkAndGenerateDailyNote(fakeSqlite);

    await vi.waitFor(() => {
      expect(mockGenerateDailyNote).toHaveBeenCalledWith(fakeSqlite, "2026-03-24");
    });
  });
});

// ============================================================
// Double-fire prevention
// ============================================================
describe("checkAndGenerateDailyNote — concurrency guard", () => {
  it("prevents double-fire while generating", async () => {
    setTime("23", "01");

    // First call: generateDailyNote returns a promise that we control
    let resolveGenerate!: (v: unknown) => void;
    mockGenerateDailyNote.mockReturnValue(
      new Promise((resolve) => {
        resolveGenerate = resolve;
      }),
    );

    // First call starts generation
    checkAndGenerateDailyNote(fakeSqlite);
    expect(mockGenerateDailyNote).toHaveBeenCalledTimes(1);

    // Second call while first is still pending — should be blocked
    checkAndGenerateDailyNote(fakeSqlite);
    expect(mockGenerateDailyNote).toHaveBeenCalledTimes(1);

    // Resolve the first call
    resolveGenerate({ date: "2026-03-24", path: "test" });

    // Wait for finally() to clear the flag
    await vi.waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalled();
    });
  });
});

// ============================================================
// Error handling
// ============================================================
describe("checkAndGenerateDailyNote — error handling", () => {
  it("does not update setting on error, resets generating flag", async () => {
    setTime("23", "01");
    mockGenerateDailyNote.mockRejectedValue(new Error("disk full"));

    checkAndGenerateDailyNote(fakeSqlite);
    expect(mockGenerateDailyNote).toHaveBeenCalledTimes(1);

    // Wait for the .finally() to reset the generating flag
    // by checking that a subsequent call actually triggers generation
    mockGenerateDailyNote.mockResolvedValue({ date: "2026-03-24", path: "ok" });

    await vi.waitFor(() => {
      // Keep trying — once the flag resets, the second call will go through
      checkAndGenerateDailyNote(fakeSqlite);
      expect(mockGenerateDailyNote).toHaveBeenCalledTimes(2);
    });

    // Should NOT have updated the date on the failed attempt
    // Only the successful second attempt updates it
    await vi.waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
    });
  });
});
