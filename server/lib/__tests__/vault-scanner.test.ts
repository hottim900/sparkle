import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestDb } from "../../test-utils.js";
import { scanVaultFiles } from "../vault-scanner.js";
import { vaultFiles } from "../../db/schema.js";
import { eq } from "drizzle-orm";

function enableObsidian(sqlite: ReturnType<typeof createTestDb>["sqlite"], vaultPath: string) {
  sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'obsidian_enabled'").run("true");
  sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'obsidian_vault_path'").run(vaultPath);
}

describe("scanVaultFiles", () => {
  let tmpDir: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let sqlite: ReturnType<typeof createTestDb>["sqlite"];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "vault-scanner-test-"));
    const testDb = createTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("indexes .md files into vault_files table", async () => {
    enableObsidian(sqlite, tmpDir);
    writeFileSync(join(tmpDir, "note.md"), "# Hello\nContent here");

    const result = await scanVaultFiles(db, sqlite);
    expect(result.scanned).toBe(1);
    expect(result.inserted).toBe(1);

    const row = db.select().from(vaultFiles).where(eq(vaultFiles.path, "note.md")).get();
    expect(row).toBeDefined();
    expect(row!.title).toBe("Hello");
    expect(row!.content).toContain("Content here");
  });

  it("extracts title from H1 heading", async () => {
    enableObsidian(sqlite, tmpDir);
    writeFileSync(join(tmpDir, "titled.md"), "# My Great Title\nBody text");

    await scanVaultFiles(db, sqlite);

    const row = db.select().from(vaultFiles).where(eq(vaultFiles.path, "titled.md")).get();
    expect(row!.title).toBe("My Great Title");
  });

  it("falls back to filename when no H1", async () => {
    enableObsidian(sqlite, tmpDir);
    writeFileSync(join(tmpDir, "no-heading.md"), "Just some text without a heading");

    await scanVaultFiles(db, sqlite);

    const row = db.select().from(vaultFiles).where(eq(vaultFiles.path, "no-heading.md")).get();
    expect(row!.title).toBe("no-heading");
  });

  it("scans subdirectories recursively", async () => {
    enableObsidian(sqlite, tmpDir);
    mkdirSync(join(tmpDir, "sub", "deep"), { recursive: true });
    writeFileSync(join(tmpDir, "root.md"), "Root file");
    writeFileSync(join(tmpDir, "sub/child.md"), "Child file");
    writeFileSync(join(tmpDir, "sub/deep/nested.md"), "Nested file");

    const result = await scanVaultFiles(db, sqlite);
    expect(result.scanned).toBe(3);
    expect(result.inserted).toBe(3);
  });

  it("excludes .obsidian directory", async () => {
    enableObsidian(sqlite, tmpDir);
    mkdirSync(join(tmpDir, ".obsidian"), { recursive: true });
    writeFileSync(join(tmpDir, ".obsidian/config.md"), "Plugin config");
    writeFileSync(join(tmpDir, "real-note.md"), "Real note");

    const result = await scanVaultFiles(db, sqlite);
    expect(result.scanned).toBe(1);
    expect(result.inserted).toBe(1);
  });

  it("excludes hidden directories", async () => {
    enableObsidian(sqlite, tmpDir);
    mkdirSync(join(tmpDir, ".hidden"), { recursive: true });
    writeFileSync(join(tmpDir, ".hidden/secret.md"), "Hidden note");
    writeFileSync(join(tmpDir, "visible.md"), "Visible note");

    const result = await scanVaultFiles(db, sqlite);
    expect(result.scanned).toBe(1);
  });

  it("skips unchanged files on second scan (mtime match)", async () => {
    enableObsidian(sqlite, tmpDir);
    writeFileSync(join(tmpDir, "stable.md"), "Stable content");

    await scanVaultFiles(db, sqlite);
    const second = await scanVaultFiles(db, sqlite);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(0);
  });

  it("removes deleted files from DB", async () => {
    enableObsidian(sqlite, tmpDir);
    const filePath = join(tmpDir, "temp.md");
    writeFileSync(filePath, "Temporary file");

    await scanVaultFiles(db, sqlite);
    expect(db.select().from(vaultFiles).all()).toHaveLength(1);

    // Delete file and rescan
    rmSync(filePath);
    const result = await scanVaultFiles(db, sqlite);
    expect(result.deleted).toBe(1);
    expect(db.select().from(vaultFiles).all()).toHaveLength(0);
  });

  it("skips when obsidian is not enabled", async () => {
    writeFileSync(join(tmpDir, "note.md"), "Content");
    const result = await scanVaultFiles(db, sqlite);
    expect(result.scanned).toBe(0);
  });

  it("extracts frontmatter when present", async () => {
    enableObsidian(sqlite, tmpDir);
    writeFileSync(join(tmpDir, "with-fm.md"), "---\ntags: [test]\ndate: 2026-01-01\n---\nBody");

    await scanVaultFiles(db, sqlite);

    const row = db.select().from(vaultFiles).where(eq(vaultFiles.path, "with-fm.md")).get();
    expect(row!.frontmatter).toBe("tags: [test]\ndate: 2026-01-01");
  });

  it("stores null frontmatter when absent", async () => {
    enableObsidian(sqlite, tmpDir);
    writeFileSync(join(tmpDir, "no-fm.md"), "No frontmatter here");

    await scanVaultFiles(db, sqlite);

    const row = db.select().from(vaultFiles).where(eq(vaultFiles.path, "no-fm.md")).get();
    expect(row!.frontmatter).toBeNull();
  });

  it("extracts sparkle_id from frontmatter into vault_files", async () => {
    enableObsidian(sqlite, tmpDir);
    writeFileSync(
      join(tmpDir, "exported.md"),
      '---\nsparkle_id: "abc-123"\ntags: []\n---\n# Exported Note\nContent',
    );

    await scanVaultFiles(db, sqlite);

    const row = db.select().from(vaultFiles).where(eq(vaultFiles.path, "exported.md")).get();
    expect(row).toBeDefined();
    expect(row!.sparkle_id).toBe("abc-123");
  });

  it("sets sparkle_id to null when not in frontmatter", async () => {
    enableObsidian(sqlite, tmpDir);
    writeFileSync(join(tmpDir, "plain.md"), "---\ntitle: Plain\n---\nNo sparkle_id");

    await scanVaultFiles(db, sqlite);

    const row = db.select().from(vaultFiles).where(eq(vaultFiles.path, "plain.md")).get();
    expect(row!.sparkle_id).toBeNull();
  });

  it("handles duplicate sparkle_id gracefully (sets to null)", async () => {
    enableObsidian(sqlite, tmpDir);
    const auditPath = join(tmpDir, "duplicate-sparkle-id.json");
    writeFileSync(join(tmpDir, "first.md"), '---\nsparkle_id: "dup-id"\n---\nFirst file');
    writeFileSync(
      join(tmpDir, "second.md"),
      '---\nsparkle_id: "dup-id"\n---\nSecond file with same id',
    );

    // Should not throw
    const result = await scanVaultFiles(db, sqlite, { auditPath });
    expect(result.errors).toBe(0);

    // One should have sparkle_id, the other null
    const rows = db.select().from(vaultFiles).all();
    const withId = rows.filter((r) => r.sparkle_id === "dup-id");
    const withNull = rows.filter((r) => r.sparkle_id === null);
    expect(withId).toHaveLength(1);
    expect(withNull).toHaveLength(1);
  });

  it("updates sparkle_id when file content changes", async () => {
    enableObsidian(sqlite, tmpDir);
    const filePath = join(tmpDir, "evolving.md");
    writeFileSync(filePath, "---\ntitle: No ID yet\n---\nContent");

    await scanVaultFiles(db, sqlite);
    let row = db.select().from(vaultFiles).where(eq(vaultFiles.path, "evolving.md")).get();
    expect(row!.sparkle_id).toBeNull();

    // Add sparkle_id — touch mtime to trigger re-scan
    const future = new Date(Date.now() + 10_000);
    writeFileSync(filePath, '---\nsparkle_id: "new-id"\ntitle: Now has ID\n---\nContent');
    utimesSync(filePath, future, future);

    await scanVaultFiles(db, sqlite);
    row = db.select().from(vaultFiles).where(eq(vaultFiles.path, "evolving.md")).get();
    expect(row!.sparkle_id).toBe("new-id");
  });

  it("path-rename does not produce NULL sparkle_id (PR 1 ordering fix)", async () => {
    enableObsidian(sqlite, tmpDir);
    mkdirSync(join(tmpDir, "0_Inbox"), { recursive: true });
    const oldPath = join(tmpDir, "0_Inbox", "moved.md");
    writeFileSync(oldPath, '---\nsparkle_id: "rename-id"\n---\n# Original\nContent');

    // First scan: file is at oldPath with sparkle_id
    await scanVaultFiles(db, sqlite);
    let row = db.select().from(vaultFiles).where(eq(vaultFiles.path, "0_Inbox/moved.md")).get();
    expect(row!.sparkle_id).toBe("rename-id");

    // User moves the file in Obsidian: 0_Inbox/moved.md → moved.md (root)
    const newPath = join(tmpDir, "moved.md");
    renameSync(oldPath, newPath);

    // Second scan: should DELETE old row before INSERT new row, no UNIQUE collision
    const result = await scanVaultFiles(db, sqlite);
    expect(result.errors).toBe(0);
    expect(result.deleted).toBe(1);
    expect(result.inserted).toBe(1);

    // The new row must keep the sparkle_id, NOT fall back to null
    row = db.select().from(vaultFiles).where(eq(vaultFiles.path, "moved.md")).get();
    expect(row).toBeDefined();
    expect(row!.sparkle_id).toBe("rename-id");

    // The old row must be gone
    const oldRow = db
      .select()
      .from(vaultFiles)
      .where(eq(vaultFiles.path, "0_Inbox/moved.md"))
      .get();
    expect(oldRow).toBeUndefined();
  });

  it("appends duplicate sparkle_id audit entry to JSON file", async () => {
    enableObsidian(sqlite, tmpDir);
    const auditDir = mkdtempSync(join(tmpdir(), "vault-scanner-audit-"));
    const auditPath = join(auditDir, "duplicate-sparkle-id.json");

    writeFileSync(join(tmpDir, "first.md"), '---\nsparkle_id: "dup-id"\n---\nFirst');
    writeFileSync(
      join(tmpDir, "second.md"),
      '---\nsparkle_id: "dup-id"\n---\nSecond, copy-paste collision',
    );

    const result = await scanVaultFiles(db, sqlite, { auditPath });
    expect(result.errors).toBe(0);

    // Both files indexed: one with sparkle_id, one without
    const rows = db.select().from(vaultFiles).all();
    expect(rows.filter((r) => r.sparkle_id === "dup-id")).toHaveLength(1);
    expect(rows.filter((r) => r.sparkle_id === null)).toHaveLength(1);

    // Audit JSON must exist and contain the conflict
    expect(existsSync(auditPath)).toBe(true);
    const audit = JSON.parse(readFileSync(auditPath, "utf-8")) as Array<{
      sparkle_id: string;
      new_path: string;
      detected: string;
    }>;
    expect(audit).toHaveLength(1);
    expect(audit[0]!.sparkle_id).toBe("dup-id");
    expect(["first.md", "second.md"]).toContain(audit[0]!.new_path);
    expect(typeof audit[0]!.detected).toBe("string");

    rmSync(auditDir, { recursive: true, force: true });
  });

  it("skips concurrent scan when one is already in progress", async () => {
    enableObsidian(sqlite, tmpDir);
    // Create enough files that a scan takes more than one event-loop tick
    for (let i = 0; i < 20; i++) {
      writeFileSync(join(tmpDir, `note-${i}.md`), `# Note ${i}\nBody ${i}`);
    }

    // Fire two scans without awaiting the first; the second must short-circuit
    const first = scanVaultFiles(db, sqlite);
    const second = scanVaultFiles(db, sqlite);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(secondResult.skipped).toBe(true);
    expect(firstResult.skipped).toBe(false);
    expect(firstResult.scanned).toBe(20);
  });
});
