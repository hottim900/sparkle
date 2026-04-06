import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestDb } from "../../test-utils.js";
import { scanExportedItems, stripFrontmatter, clearMtimeCache } from "../vault-watcher.js";
import { vaultFiles } from "../../db/schema.js";

function insertItem(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  id: string,
  content: string,
  exportPath: string | null = null,
) {
  sqlite
    .prepare(
      `INSERT INTO items (id, title, content, status, export_path, created, modified)
     VALUES (?, ?, ?, 'exported', ?, '2026-01-01', '2026-01-01')`,
    )
    .run(id, `Title ${id}`, content, exportPath);
}

function enableObsidian(sqlite: ReturnType<typeof createTestDb>["sqlite"], vaultPath: string) {
  sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'obsidian_enabled'").run("true");
  sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'obsidian_vault_path'").run(vaultPath);
}

describe("stripFrontmatter", () => {
  it("strips YAML frontmatter", () => {
    const raw = `---\nsparkle_id: "abc"\ntags: []\n---\nHello world`;
    expect(stripFrontmatter(raw)).toBe("Hello world");
  });

  it("returns content as-is when no frontmatter", () => {
    expect(stripFrontmatter("No frontmatter here")).toBe("No frontmatter here");
  });

  it("returns content as-is when frontmatter is unclosed", () => {
    expect(stripFrontmatter("---\nunclosed")).toBe("---\nunclosed");
  });
});

describe("scanExportedItems", () => {
  let tmpDir: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let sqlite: ReturnType<typeof createTestDb>["sqlite"];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "vault-watcher-test-"));
    mkdirSync(join(tmpDir, "0_Inbox"), { recursive: true });
    const testDb = createTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
    clearMtimeCache();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips when obsidian is not enabled", async () => {
    insertItem(sqlite, "item-1", "Original", "0_Inbox/Test.md");
    const result = await scanExportedItems(db, sqlite);
    expect(result).toEqual({ scanned: 0, updated: 0, errors: 0 });
  });

  it("skips when vault_path is empty", async () => {
    sqlite.prepare("UPDATE settings SET value = 'true' WHERE key = 'obsidian_enabled'").run();
    insertItem(sqlite, "item-1", "Original", "0_Inbox/Test.md");
    const result = await scanExportedItems(db, sqlite);
    expect(result).toEqual({ scanned: 0, updated: 0, errors: 0 });
  });

  it("updates content when vault file has changed", async () => {
    enableObsidian(sqlite, tmpDir);
    insertItem(sqlite, "item-1", "Original content", "0_Inbox/Test.md");

    // Write vault file with different content
    const filePath = join(tmpDir, "0_Inbox/Test.md");
    writeFileSync(filePath, `---\nsparkle_id: "item-1"\n---\nUpdated content from vault`);

    const result = await scanExportedItems(db, sqlite);
    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(1);

    // Verify DB was updated
    const row = sqlite.prepare("SELECT content FROM items WHERE id = 'item-1'").get() as {
      content: string;
    };
    expect(row.content).toBe("Updated content from vault");
  });

  it("does NOT update items.modified on content sync", async () => {
    enableObsidian(sqlite, tmpDir);
    insertItem(sqlite, "item-1", "Original", "0_Inbox/Test.md");

    writeFileSync(join(tmpDir, "0_Inbox/Test.md"), `---\nsparkle_id: "item-1"\n---\nNew content`);

    await scanExportedItems(db, sqlite);

    const row = sqlite.prepare("SELECT modified FROM items WHERE id = 'item-1'").get() as {
      modified: string;
    };
    expect(row.modified).toBe("2026-01-01");
  });

  it("skips when file content matches DB (hash match)", async () => {
    enableObsidian(sqlite, tmpDir);
    const content = "Same content";
    insertItem(sqlite, "item-1", content, "0_Inbox/Test.md");

    writeFileSync(join(tmpDir, "0_Inbox/Test.md"), `---\nsparkle_id: "item-1"\n---\n${content}`);

    const result = await scanExportedItems(db, sqlite);
    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(0);
  });

  it("skips when mtime has not changed since last scan", async () => {
    enableObsidian(sqlite, tmpDir);
    insertItem(sqlite, "item-1", "Original", "0_Inbox/Test.md");

    const filePath = join(tmpDir, "0_Inbox/Test.md");
    writeFileSync(filePath, `---\nsparkle_id: "item-1"\n---\nChanged`);

    // First scan: reads and updates
    const first = await scanExportedItems(db, sqlite);
    expect(first.updated).toBe(1);

    // Second scan: same mtime, should skip
    const second = await scanExportedItems(db, sqlite);
    expect(second.updated).toBe(0);
  });

  it("re-scans when mtime changes after initial scan", async () => {
    enableObsidian(sqlite, tmpDir);
    insertItem(sqlite, "item-1", "Original", "0_Inbox/Test.md");

    const filePath = join(tmpDir, "0_Inbox/Test.md");
    writeFileSync(filePath, `---\nsparkle_id: "item-1"\n---\nFirst edit`);

    await scanExportedItems(db, sqlite);

    // Touch the file with a new mtime and different content
    writeFileSync(filePath, `---\nsparkle_id: "item-1"\n---\nSecond edit`);
    // Force different mtime by shifting 2 seconds into the future
    const futureTime = new Date(Date.now() + 2000);
    utimesSync(filePath, futureTime, futureTime);

    const result = await scanExportedItems(db, sqlite);
    expect(result.updated).toBe(1);

    const row = sqlite.prepare("SELECT content FROM items WHERE id = 'item-1'").get() as {
      content: string;
    };
    expect(row.content).toBe("Second edit");
  });

  it("handles deleted vault file gracefully (ENOENT)", async () => {
    enableObsidian(sqlite, tmpDir);
    insertItem(sqlite, "item-1", "Original", "0_Inbox/Deleted.md");
    // File doesn't exist — should not throw, not count as error
    const result = await scanExportedItems(db, sqlite);
    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.errors).toBe(0);
  });

  it("counts non-ENOENT errors", async () => {
    enableObsidian(sqlite, tmpDir);
    // Point to a directory instead of a file — will cause EISDIR or similar
    insertItem(sqlite, "item-1", "Original", "0_Inbox");
    const result = await scanExportedItems(db, sqlite);
    expect(result.errors).toBe(1);
  });

  it("self-heals export_path via sparkle_id when file not found (ENOENT)", async () => {
    enableObsidian(sqlite, tmpDir);
    // Item has wrong export_path, but vault_files has correct mapping via sparkle_id
    insertItem(sqlite, "item-heal", "Original", "0_Inbox/Wrong.md");

    // Insert vault_files entry with correct path and matching sparkle_id
    db.insert(vaultFiles)
      .values({
        path: "Correct.md",
        title: "Correct File",
        content: "Content",
        mtime: 1700000000,
        content_hash: "hash",
        sparkle_id: "item-heal",
      })
      .run();

    const result = await scanExportedItems(db, sqlite);
    expect(result.errors).toBe(0);

    // Verify export_path was self-healed
    const row = sqlite.prepare("SELECT export_path FROM items WHERE id = 'item-heal'").get() as {
      export_path: string;
    };
    expect(row.export_path).toBe("Correct.md");
  });

  it("does not self-heal when sparkle_id not in vault_files", async () => {
    enableObsidian(sqlite, tmpDir);
    insertItem(sqlite, "item-no-match", "Original", "0_Inbox/Missing.md");

    const result = await scanExportedItems(db, sqlite);
    expect(result.errors).toBe(0);

    // export_path should remain unchanged
    const row = sqlite
      .prepare("SELECT export_path FROM items WHERE id = 'item-no-match'")
      .get() as { export_path: string };
    expect(row.export_path).toBe("0_Inbox/Missing.md");
  });

  it("skips items reverted to permanent (no longer exported)", async () => {
    enableObsidian(sqlite, tmpDir);
    insertItem(sqlite, "item-1", "Original content", "0_Inbox/Reverted.md");

    // Revert the item to permanent status (simulating user action)
    sqlite.prepare("UPDATE items SET status = 'permanent' WHERE id = 'item-1'").run();

    // Write a different file in the vault
    const filePath = join(tmpDir, "0_Inbox/Reverted.md");
    writeFileSync(filePath, `---\nsparkle_id: "item-1"\n---\nChanged in vault`);

    const result = await scanExportedItems(db, sqlite);
    // Item is no longer exported, so it should not be scanned
    expect(result.scanned).toBe(0);
    expect(result.updated).toBe(0);

    // Verify DB content is unchanged
    const row = sqlite.prepare("SELECT content FROM items WHERE id = 'item-1'").get() as {
      content: string;
    };
    expect(row.content).toBe("Original content");
  });
});
