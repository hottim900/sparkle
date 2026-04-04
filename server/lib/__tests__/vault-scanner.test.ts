import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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
});
