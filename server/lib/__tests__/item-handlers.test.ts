import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "../../test-utils.js";
import { createItem, getItem } from "../items.js";
import { setSession } from "../line-session.js";
import { itemHandlers } from "../line-commands/item-handlers.js";
import type { CommandContext } from "../line-commands/types.js";

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

vi.mock("../export.js", () => ({
  exportToObsidian: vi.fn().mockResolvedValue({ path: "0_Inbox/Test-Note.md", skipped: false }),
}));

const TEST_USER = "test-user";

describe("LINE item-handlers — exported read-only guard", () => {
  let db: ReturnType<typeof createTestDb>["db"];
  let sqlite: ReturnType<typeof createTestDb>["sqlite"];

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  function makeCtx(command: CommandContext["command"]): CommandContext {
    return { userId: TEST_USER, command, db, sqlite };
  }

  it("handleTag on exported item returns error containing '已匯出'", async () => {
    const item = createItem(db, { title: "Exported Note", type: "note", status: "exported" });
    setSession(TEST_USER, [item.id]);

    const result = await itemHandlers.tag!(makeCtx({ type: "tag", index: 1, tags: ["new-tag"] }));
    expect(result).toContain("已匯出");

    // Verify tags unchanged
    const fetched = getItem(db, item.id);
    expect(JSON.parse(fetched!.tags)).toEqual([]);
  });

  it("handlePriority on exported item returns error containing '已匯出'", async () => {
    const item = createItem(db, { title: "Exported Note", type: "note", status: "exported" });
    setSession(TEST_USER, [item.id]);

    const result = await itemHandlers.priority!(
      makeCtx({ type: "priority", index: 1, priority: "high" }),
    );
    expect(result).toContain("已匯出");

    // Verify priority unchanged
    const fetched = getItem(db, item.id);
    expect(fetched!.priority).toBeNull();
  });

  it("handleUntag on exported item returns error containing '已匯出'", async () => {
    const item = createItem(db, {
      title: "Exported Note",
      type: "note",
      status: "exported",
      tags: ["keep-me"],
    });
    setSession(TEST_USER, [item.id]);

    const result = await itemHandlers.untag!(
      makeCtx({ type: "untag", index: 1, tags: ["keep-me"] }),
    );
    expect(result).toContain("已匯出");

    // Verify tags unchanged
    const fetched = getItem(db, item.id);
    expect(JSON.parse(fetched!.tags)).toEqual(["keep-me"]);
  });

  it("handleDue on exported item returns error containing '已匯出'", async () => {
    // Note: handleDue checks exported before checking type=todo
    const item = createItem(db, { title: "Exported Note", type: "note", status: "exported" });
    setSession(TEST_USER, [item.id]);

    const result = await itemHandlers.due!(
      makeCtx({ type: "due", index: 1, dateInput: "2026-04-01" }),
    );
    expect(result).toContain("已匯出");
  });

  it("handleExport sets export_path in DB", async () => {
    // Create a permanent note, set up obsidian settings
    const item = createItem(db, { title: "Test Note", type: "note", status: "permanent" });
    setSession(TEST_USER, [item.id]);

    // Enable obsidian settings
    sqlite.prepare("UPDATE settings SET value = 'true' WHERE key = 'obsidian_enabled'").run();
    sqlite
      .prepare("UPDATE settings SET value = '/tmp/test-vault' WHERE key = 'obsidian_vault_path'")
      .run();

    const result = await itemHandlers.export!(makeCtx({ type: "export", index: 1 }));
    expect(result).toContain("已匯出到 Obsidian");

    // Verify export_path was written to DB
    const row = sqlite
      .prepare("SELECT export_path, status FROM items WHERE id = ?")
      .get(item.id) as {
      export_path: string | null;
      status: string;
    };
    expect(row.status).toBe("exported");
    expect(row.export_path).toBe("0_Inbox/Test-Note.md");
  });
});
