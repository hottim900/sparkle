import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestDb } from "../../test-utils.js";
import type Database from "better-sqlite3";

// Mock settings to control obsidian/daily-note config
const mockGetObsidianSettings = vi.fn();
const mockGetDailyNoteSettings = vi.fn();

vi.mock("../settings.js", () => ({
  getObsidianSettings: (...args: unknown[]) => mockGetObsidianSettings(...args),
  getDailyNoteSettings: (...args: unknown[]) => mockGetDailyNoteSettings(...args),
}));

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { generateDailyNote } from "../daily-note.js";

// --- Helpers ---

let tempDir: string;
let sqlite: Database.Database;

function enableObsidian() {
  mockGetObsidianSettings.mockReturnValue({
    obsidian_enabled: true,
    obsidian_vault_path: tempDir,
    obsidian_inbox_folder: "0_Inbox",
    obsidian_export_mode: "overwrite",
  });
}

function setDailyNoteSettings(overrides: Record<string, string> = {}) {
  mockGetDailyNoteSettings.mockReturnValue({
    obsidian_daily_folder: "Daily",
    daily_note_time: "23:00",
    daily_note_mode: "subfolder",
    ...overrides,
  });
}

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
      `INSERT INTO items (id, type, title, content, status, priority, due, tags, origin, source, aliases, linked_note_id, category_id, viewed_at, is_private, created, modified)
       VALUES (@id, @type, @title, @content, @status, @priority, @due, @tags, @origin, @source, @aliases, @linked_note_id, @category_id, @viewed_at, @is_private, @created, @modified)`,
    )
    .run(item);
  return item;
}

// --- Setup ---

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sparkle-daily-note-test-"));
  const testDb = createTestDb();
  sqlite = testDb.sqlite;
  enableObsidian();
  setDailyNoteSettings();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  sqlite.close();
});

// ============================================================
// Date validation
// ============================================================
describe("generateDailyNote — date validation", () => {
  it("rejects invalid date format", async () => {
    await expect(generateDailyNote(sqlite, "2026-3-24")).rejects.toThrow("Invalid date format");
  });

  it("rejects non-existent calendar date", async () => {
    await expect(generateDailyNote(sqlite, "2026-02-30")).rejects.toThrow("Invalid date");
  });

  it("accepts valid date", async () => {
    const result = await generateDailyNote(sqlite, "2026-03-24");
    // Should not throw — may be skipped due to no activity
    expect(result.date).toBe("2026-03-24");
  });
});

// ============================================================
// Early returns (skip conditions)
// ============================================================
describe("generateDailyNote — skip conditions", () => {
  it("skips when obsidian is disabled", async () => {
    mockGetObsidianSettings.mockReturnValue({
      obsidian_enabled: false,
      obsidian_vault_path: tempDir,
    });
    const result = await generateDailyNote(sqlite, "2026-03-24");
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("disabled");
  });

  it("skips when vault path is not set", async () => {
    mockGetObsidianSettings.mockReturnValue({
      obsidian_enabled: true,
      obsidian_vault_path: "",
    });
    const result = await generateDailyNote(sqlite, "2026-03-24");
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("vault path");
  });

  it("skips when no activity for the date", async () => {
    const result = await generateDailyNote(sqlite, "2026-03-24");
    expect(result.skipped).toBe(true);
    expect(result.reason).toContain("No activity");
  });
});

// ============================================================
// Subfolder mode
// ============================================================
describe("generateDailyNote — subfolder mode", () => {
  it("writes to Daily/Sparkle/{date}.md", async () => {
    insertItem({ created: "2026-03-24T10:00:00.000Z" });
    const result = await generateDailyNote(sqlite, "2026-03-24");

    expect(result.skipped).toBeUndefined();
    expect(result.path).toBe("Daily/Sparkle/2026-03-24.md");

    const content = readFileSync(join(tempDir, "Daily", "Sparkle", "2026-03-24.md"), "utf-8");
    expect(content).toContain("sparkle_date: 2026-03-24");
    expect(content).toContain("# 2026-03-24");
  });

  it("is idempotent (overwrites on re-generation)", async () => {
    insertItem({ title: "First Run", created: "2026-03-24T10:00:00.000Z" });
    await generateDailyNote(sqlite, "2026-03-24");

    // Modify data and re-generate
    insertItem({ title: "Second Run", created: "2026-03-24T11:00:00.000Z" });
    const result = await generateDailyNote(sqlite, "2026-03-24");

    expect(result.path).toBe("Daily/Sparkle/2026-03-24.md");
    const content = readFileSync(join(tempDir, "Daily", "Sparkle", "2026-03-24.md"), "utf-8");
    expect(content).toContain("Second Run");
  });

  it("uses custom daily folder", async () => {
    setDailyNoteSettings({ obsidian_daily_folder: "Journal" });
    insertItem({ created: "2026-03-24T10:00:00.000Z" });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    expect(result.path).toBe("Journal/Sparkle/2026-03-24.md");
  });
});

// ============================================================
// Append mode
// ============================================================
describe("generateDailyNote — append mode", () => {
  beforeEach(() => {
    setDailyNoteSettings({ daily_note_mode: "append" });
  });

  it("creates new file when none exists", async () => {
    insertItem({ created: "2026-03-24T10:00:00.000Z" });
    const result = await generateDailyNote(sqlite, "2026-03-24");

    expect(result.path).toBe("Daily/2026-03-24.md");
    const content = readFileSync(join(tempDir, "Daily", "2026-03-24.md"), "utf-8");
    expect(content).toContain("<!-- sparkle:2026-03-24 -->");
    expect(content).toContain("## Sparkle 活動");
    expect(content).toContain("<!-- /sparkle -->");
  });

  it("appends to existing file without marker", async () => {
    const dailyDir = join(tempDir, "Daily");
    mkdirSync(dailyDir, { recursive: true });
    writeFileSync(join(dailyDir, "2026-03-24.md"), "# My daily note\n\nSome thoughts.\n", "utf-8");

    insertItem({ created: "2026-03-24T10:00:00.000Z" });
    const result = await generateDailyNote(sqlite, "2026-03-24");

    expect(result.path).toBe("Daily/2026-03-24.md");
    const content = readFileSync(join(dailyDir, "2026-03-24.md"), "utf-8");
    // Original content preserved
    expect(content).toContain("# My daily note");
    expect(content).toContain("Some thoughts.");
    // Sparkle section appended
    expect(content).toContain("<!-- sparkle:2026-03-24 -->");
    expect(content).toContain("## Sparkle 活動");
  });

  it("replaces existing sparkle section (with close marker)", async () => {
    const dailyDir = join(tempDir, "Daily");
    mkdirSync(dailyDir, { recursive: true });
    const existing = [
      "# My daily note",
      "",
      "Some thoughts.",
      "",
      "<!-- sparkle:2026-03-24 -->",
      "## Sparkle 活動",
      "",
      "### 捕捉",
      "- old note",
      "",
      "<!-- /sparkle -->",
      "",
      "## Other section",
      "More content",
    ].join("\n");
    writeFileSync(join(dailyDir, "2026-03-24.md"), existing, "utf-8");

    insertItem({ title: "New Note", created: "2026-03-24T10:00:00.000Z" });
    const result = await generateDailyNote(sqlite, "2026-03-24");

    expect(result.path).toBe("Daily/2026-03-24.md");
    const content = readFileSync(join(dailyDir, "2026-03-24.md"), "utf-8");
    // Old sparkle content replaced
    expect(content).not.toContain("old note");
    // New sparkle content present
    expect(content).toContain("New Note");
    // Surrounding content preserved
    expect(content).toContain("# My daily note");
    expect(content).toContain("## Other section");
    expect(content).toContain("More content");
  });

  it("replaces existing sparkle section (no close marker, falls back to next heading)", async () => {
    const dailyDir = join(tempDir, "Daily");
    mkdirSync(dailyDir, { recursive: true });
    const existing = [
      "# My daily note",
      "",
      "<!-- sparkle:2026-03-24 -->",
      "## Sparkle 活動",
      "",
      "- old content",
      "",
      "## Evening thoughts",
      "Some reflection",
    ].join("\n");
    writeFileSync(join(dailyDir, "2026-03-24.md"), existing, "utf-8");

    insertItem({ title: "Updated Note", created: "2026-03-24T10:00:00.000Z" });
    await generateDailyNote(sqlite, "2026-03-24");

    const content = readFileSync(join(dailyDir, "2026-03-24.md"), "utf-8");
    expect(content).not.toContain("old content");
    expect(content).toContain("Updated Note");
    // The next heading should be preserved
    expect(content).toContain("## Evening thoughts");
  });
});

// ============================================================
// Markdown content — frontmatter
// ============================================================
describe("generateDailyNote — markdown content", () => {
  it("includes correct frontmatter fields", async () => {
    insertItem({ created: "2026-03-24T10:00:00.000Z", origin: "line" });
    insertItem({
      type: "todo",
      status: "active",
      due: "2026-03-24",
      created: "2026-03-20T10:00:00.000Z",
    });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    const content = readFileSync(join(tempDir, result.path), "utf-8");

    expect(content).toContain("sparkle_date: 2026-03-24");
    expect(content).toContain("sparkle_notes_created: 1");
    expect(content).toContain("sparkle_todos_due: 1");
    expect(content).toContain("tags: [sparkle/daily]");
  });

  it("includes origins in frontmatter", async () => {
    insertItem({ origin: "line", created: "2026-03-24T10:00:00.000Z" });
    insertItem({
      origin: "web",
      created: "2026-03-24T11:00:00.000Z",
    });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    const content = readFileSync(join(tempDir, result.path), "utf-8");

    expect(content).toContain("sparkle_origins:");
    expect(content).toContain('"line"');
    expect(content).toContain('"web"');
  });

  it("omits origins line when no origins", async () => {
    insertItem({ origin: null, created: "2026-03-24T10:00:00.000Z" });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    const content = readFileSync(join(tempDir, result.path), "utf-8");

    expect(content).not.toContain("sparkle_origins:");
  });

  it("includes day-of-week in Chinese", async () => {
    // 2026-03-24 is a Tuesday (二)
    insertItem({ created: "2026-03-24T10:00:00.000Z" });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    const content = readFileSync(join(tempDir, result.path), "utf-8");

    expect(content).toContain("# 2026-03-24 (二)");
  });
});

// ============================================================
// Markdown content — sections
// ============================================================
describe("generateDailyNote — sections", () => {
  it("renders 捕捉 section for created notes", async () => {
    insertItem({
      title: "New Idea",
      status: "fleeting",
      origin: "line",
      created: "2026-03-24T10:00:00.000Z",
    });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    const content = readFileSync(join(tempDir, result.path), "utf-8");

    expect(content).toContain("## 捕捉");
    expect(content).toMatch(/\[\[New Idea\|sparkle-/);
    expect(content).toContain("(fleeting, via line)");
  });

  it("renders 活躍筆記 section for modified notes (not same-day created)", async () => {
    // Created yesterday, modified today
    insertItem({
      title: "Developing Note",
      status: "developing",
      created: "2026-03-23T10:00:00.000Z",
      modified: "2026-03-24T14:00:00.000Z",
    });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    const content = readFileSync(join(tempDir, result.path), "utf-8");

    expect(content).toContain("## 活躍筆記");
    expect(content).toContain("(developing, 今日修改)");
  });

  it("renders 待辦 section with priority", async () => {
    insertItem({
      type: "todo",
      title: "Important Task",
      status: "active",
      priority: "high",
      due: "2026-03-24",
      created: "2026-03-20T10:00:00.000Z",
    });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    const content = readFileSync(join(tempDir, result.path), "utf-8");

    expect(content).toContain("## 待辦");
    expect(content).toContain("- [ ] Important Task (HIGH)");
    expect(content).toMatch(/`sparkle:[a-f0-9]{7}`/);
  });

  it("renders 逾期 section for overdue todos", async () => {
    insertItem({
      type: "todo",
      title: "Overdue Task",
      status: "active",
      due: "2026-03-22",
      created: "2026-03-20T10:00:00.000Z",
    });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    const content = readFileSync(join(tempDir, result.path), "utf-8");

    expect(content).toContain("## 逾期");
    expect(content).toContain("(due: 2026-03-22)");
  });

  it("omits empty sections", async () => {
    // Only a created note — no modified, no todos, no overdue
    insertItem({ created: "2026-03-24T10:00:00.000Z" });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    const content = readFileSync(join(tempDir, result.path), "utf-8");

    expect(content).toContain("## 捕捉");
    expect(content).not.toContain("## 活躍筆記");
    expect(content).not.toContain("## 待辦");
    expect(content).not.toContain("## 逾期");
  });
});

// ============================================================
// Query behavior — deduplication & privacy
// ============================================================
describe("generateDailyNote — query behavior", () => {
  it("deduplicates: same-day created note not in 活躍筆記", async () => {
    // Created AND modified same day
    insertItem({
      title: "Same Day Note",
      created: "2026-03-24T10:00:00.000Z",
      modified: "2026-03-24T15:00:00.000Z",
    });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    const content = readFileSync(join(tempDir, result.path), "utf-8");

    expect(content).toContain("## 捕捉");
    // Should appear in 捕捉 only, not in 活躍筆記
    expect(content).not.toContain("## 活躍筆記");
  });

  it("excludes private items", async () => {
    insertItem({
      title: "Public Note",
      is_private: 0,
      created: "2026-03-24T10:00:00.000Z",
    });
    insertItem({
      title: "Secret Note",
      is_private: 1,
      created: "2026-03-24T11:00:00.000Z",
    });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    const content = readFileSync(join(tempDir, result.path), "utf-8");

    expect(content).toContain("Public Note");
    expect(content).not.toContain("Secret Note");
  });

  it("excludes archived notes", async () => {
    insertItem({
      title: "Active Note",
      status: "fleeting",
      created: "2026-03-24T10:00:00.000Z",
    });
    insertItem({
      title: "Archived Note",
      status: "archived",
      created: "2026-03-24T11:00:00.000Z",
    });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    const content = readFileSync(join(tempDir, result.path), "utf-8");

    expect(content).toContain("Active Note");
    expect(content).not.toContain("Archived Note");
  });

  it("excludes done/archived todos from due list", async () => {
    insertItem({
      type: "todo",
      title: "Active Todo",
      status: "active",
      due: "2026-03-24",
      created: "2026-03-20T10:00:00.000Z",
    });
    insertItem({
      type: "todo",
      title: "Done Todo",
      status: "done",
      due: "2026-03-24",
      created: "2026-03-20T10:00:00.000Z",
    });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    const content = readFileSync(join(tempDir, result.path), "utf-8");

    expect(content).toContain("Active Todo");
    expect(content).not.toContain("Done Todo");
  });
});

// ============================================================
// Wikilink safety
// ============================================================
describe("generateDailyNote — safe title", () => {
  it("escapes pipe characters in title", async () => {
    insertItem({
      title: "Option A | Option B",
      created: "2026-03-24T10:00:00.000Z",
    });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    const content = readFileSync(join(tempDir, result.path), "utf-8");

    expect(content).toContain("Option A - Option B");
    expect(content).not.toContain("Option A | Option B");
  });

  it("escapes [[ and ]] in title", async () => {
    insertItem({
      title: "Link to [[other]]",
      created: "2026-03-24T10:00:00.000Z",
    });

    const result = await generateDailyNote(sqlite, "2026-03-24");
    const content = readFileSync(join(tempDir, result.path), "utf-8");

    expect(content).not.toContain("[[other]]");
    expect(content).toContain("（other）");
  });
});

// ============================================================
// Path traversal protection
// ============================================================
describe("generateDailyNote — path security", () => {
  it("rejects path traversal in daily folder", async () => {
    setDailyNoteSettings({ obsidian_daily_folder: "../../etc" });
    insertItem({ created: "2026-03-24T10:00:00.000Z" });

    await expect(generateDailyNote(sqlite, "2026-03-24")).rejects.toThrow(
      "Path traversal detected",
    );
  });
});
