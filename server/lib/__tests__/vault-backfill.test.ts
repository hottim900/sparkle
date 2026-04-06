import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestDb } from "../../test-utils.js";
import { backfillExportPaths, extractSparkleId } from "../vault-backfill.js";

function insertItem(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  id: string,
  opts: { exportPath?: string | null; status?: string } = {},
) {
  const { exportPath = null, status = "exported" } = opts;
  sqlite
    .prepare(
      `INSERT INTO items (id, title, content, status, export_path, created, modified)
     VALUES (?, ?, 'content', ?, ?, '2026-01-01', '2026-01-01')`,
    )
    .run(id, `Title ${id}`, status, exportPath);
}

function enableObsidian(sqlite: ReturnType<typeof createTestDb>["sqlite"], vaultPath: string) {
  sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'obsidian_enabled'").run("true");
  sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'obsidian_vault_path'").run(vaultPath);
}

describe("extractSparkleId", () => {
  it("extracts quoted sparkle_id from frontmatter", () => {
    const content = `---\nsparkle_id: "abc-123"\ntags: []\n---\nBody`;
    expect(extractSparkleId(content)).toBe("abc-123");
  });

  it("extracts unquoted sparkle_id from frontmatter", () => {
    const content = `---\nsparkle_id: abc-123\n---\nBody`;
    expect(extractSparkleId(content)).toBe("abc-123");
  });

  it("returns null when no frontmatter", () => {
    expect(extractSparkleId("No frontmatter here")).toBeNull();
  });

  it("returns null when no sparkle_id in frontmatter", () => {
    const content = `---\ntitle: Test\ntags: []\n---\nBody`;
    expect(extractSparkleId(content)).toBeNull();
  });

  it("returns null when frontmatter is unclosed", () => {
    expect(extractSparkleId("---\nsparkle_id: abc")).toBeNull();
  });

  it("handles \\r\\n line endings (Windows/Obsidian)", () => {
    const content = '---\r\nsparkle_id: "win-123"\r\ntags: []\r\n---\r\nBody';
    expect(extractSparkleId(content)).toBe("win-123");
  });
});

describe("backfillExportPaths", () => {
  let tmpDir: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let sqlite: ReturnType<typeof createTestDb>["sqlite"];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "vault-backfill-test-"));
    mkdirSync(join(tmpDir, "0_Inbox"), { recursive: true });
    const testDb = createTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips when obsidian is not enabled", async () => {
    insertItem(sqlite, "item-1");
    const result = await backfillExportPaths(db, sqlite);
    expect(result).toEqual({ matched: 0, scanned: 0 });
  });

  it("matches file with sparkle_id to DB item and writes export_path", async () => {
    enableObsidian(sqlite, tmpDir);
    insertItem(sqlite, "item-1");

    writeFileSync(
      join(tmpDir, "0_Inbox/Test Note.md"),
      `---\nsparkle_id: "item-1"\ntags: []\n---\nSome content`,
    );

    const result = await backfillExportPaths(db, sqlite);
    expect(result.matched).toBe(1);
    expect(result.scanned).toBe(1);

    const row = sqlite.prepare("SELECT export_path FROM items WHERE id = 'item-1'").get() as {
      export_path: string | null;
    };
    expect(row.export_path).toBe("0_Inbox/Test Note.md");
  });

  it("skips file without sparkle_id", async () => {
    enableObsidian(sqlite, tmpDir);
    insertItem(sqlite, "item-1");

    writeFileSync(join(tmpDir, "0_Inbox/NoId.md"), `---\ntitle: No Sparkle ID\n---\nContent`);

    const result = await backfillExportPaths(db, sqlite);
    expect(result.matched).toBe(0);
    expect(result.scanned).toBe(1);
  });

  it("skips file with sparkle_id not in DB", async () => {
    enableObsidian(sqlite, tmpDir);
    insertItem(sqlite, "item-1");

    writeFileSync(
      join(tmpDir, "0_Inbox/Unknown.md"),
      `---\nsparkle_id: "nonexistent-id"\n---\nContent`,
    );

    const result = await backfillExportPaths(db, sqlite);
    expect(result.matched).toBe(0);
  });

  it("skips items that already have export_path", async () => {
    enableObsidian(sqlite, tmpDir);
    insertItem(sqlite, "item-1", { exportPath: "0_Inbox/Existing.md" });

    writeFileSync(join(tmpDir, "0_Inbox/Test.md"), `---\nsparkle_id: "item-1"\n---\nContent`);

    const result = await backfillExportPaths(db, sqlite);
    expect(result.matched).toBe(0);

    // Original export_path preserved
    const row = sqlite.prepare("SELECT export_path FROM items WHERE id = 'item-1'").get() as {
      export_path: string;
    };
    expect(row.export_path).toBe("0_Inbox/Existing.md");
  });

  it("handles inaccessible inbox directory gracefully", async () => {
    enableObsidian(sqlite, "/nonexistent/vault/path");
    insertItem(sqlite, "item-1");

    const result = await backfillExportPaths(db, sqlite);
    expect(result).toEqual({ matched: 0, scanned: 0 });
  });

  it("is idempotent — running twice produces same result", async () => {
    enableObsidian(sqlite, tmpDir);
    insertItem(sqlite, "item-1");

    writeFileSync(join(tmpDir, "0_Inbox/Test.md"), `---\nsparkle_id: "item-1"\n---\nContent`);

    await backfillExportPaths(db, sqlite);
    const second = await backfillExportPaths(db, sqlite);
    expect(second.matched).toBe(0); // Already backfilled
  });
});
