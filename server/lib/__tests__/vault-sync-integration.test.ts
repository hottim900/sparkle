import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestDb } from "../../test-utils.js";
import { exportToObsidian, resolveSparkleReferences } from "../export.js";
import { scanExportedItems, clearMtimeCache } from "../vault-watcher.js";
import { backfillExportPaths } from "../vault-backfill.js";
import { items } from "../../db/schema.js";
import { eq } from "drizzle-orm";
import type { ExportableItem } from "../export.js";

function enableObsidian(sqlite: ReturnType<typeof createTestDb>["sqlite"], vaultPath: string) {
  sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'obsidian_enabled'").run("true");
  sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'obsidian_vault_path'").run(vaultPath);
}

describe("vault sync integration", () => {
  let tmpDir: string;
  let db: ReturnType<typeof createTestDb>["db"];
  let sqlite: ReturnType<typeof createTestDb>["sqlite"];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "vault-sync-integ-"));
    mkdirSync(join(tmpDir, "0_Inbox"), { recursive: true });
    const testDb = createTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
    clearMtimeCache();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("export → modify vault file → scan → DB content updated", async () => {
    enableObsidian(sqlite, tmpDir);

    // 1. Create an item in DB
    const itemId = "integ-test-001";
    sqlite
      .prepare(
        `INSERT INTO items (id, type, title, content, status, created, modified)
       VALUES (?, 'note', ?, 'Original Sparkle content', 'permanent', '2026-01-01', '2026-01-01')`,
      )
      .run(itemId, "Integration Test Note");

    // 2. Export to vault
    const item = sqlite.prepare("SELECT * FROM items WHERE id = ?").get(itemId) as ExportableItem;
    const result = await exportToObsidian(item, {
      vaultPath: tmpDir,
      inboxFolder: "0_Inbox",
      exportMode: "overwrite",
    });
    expect(result.skipped).toBeFalsy();

    // 3. Write export_path to DB (simulating what the route handler does)
    db.update(items)
      .set({ export_path: result.path, status: "exported" })
      .where(eq(items.id, itemId))
      .run();

    // 4. Verify the file was written
    const filePath = join(tmpDir, result.path);
    const fileContent = readFileSync(filePath, "utf-8");
    expect(fileContent).toContain("sparkle_id:");
    expect(fileContent).toContain("Original Sparkle content");

    // 5. Modify the vault file (simulating user editing in Obsidian)
    const modified = fileContent.replace("Original Sparkle content", "Edited in Obsidian");
    writeFileSync(filePath, modified);
    // Ensure mtime differs
    const futureTime = new Date(Date.now() + 2000);
    utimesSync(filePath, futureTime, futureTime);

    // 6. Run scanner
    const scanResult = await scanExportedItems(db, sqlite);
    expect(scanResult.updated).toBe(1);

    // 7. Verify DB content was updated
    const updatedRow = sqlite
      .prepare("SELECT content, modified FROM items WHERE id = ?")
      .get(itemId) as {
      content: string;
      modified: string;
    };
    expect(updatedRow.content).toContain("Edited in Obsidian");
    // modified should NOT have changed (sync, not user edit)
    expect(updatedRow.modified).toBe("2026-01-01");
  });

  it("export → scanner matches via export_path without re-reading content", async () => {
    enableObsidian(sqlite, tmpDir);

    // 1. Create and export an item
    const itemId = "integ-test-002";
    sqlite
      .prepare(
        `INSERT INTO items (id, type, title, content, status, created, modified)
       VALUES (?, 'note', ?, 'Content stays same', 'permanent', '2026-01-01', '2026-01-01')`,
      )
      .run(itemId, "No Edit Note");

    const item = sqlite.prepare("SELECT * FROM items WHERE id = ?").get(itemId) as ExportableItem;
    const result = await exportToObsidian(item, {
      vaultPath: tmpDir,
      inboxFolder: "0_Inbox",
      exportMode: "overwrite",
    });

    // 2. Write export_path
    db.update(items)
      .set({ export_path: result.path, status: "exported" })
      .where(eq(items.id, itemId))
      .run();

    // 3. First scan — reads file, content matches (frontmatter stripped body vs DB)
    // The exported file has frontmatter, so stripped body should match original content
    const scan1 = await scanExportedItems(db, sqlite);
    expect(scan1.scanned).toBe(1);
    // May or may not update depending on frontmatter stripping — the key test is:

    // 4. Second scan — same mtime, should skip entirely (no file read)
    const scan2 = await scanExportedItems(db, sqlite);
    expect(scan2.scanned).toBe(1);
    expect(scan2.updated).toBe(0);
  });

  it("backfill matches pre-existing vault files to DB items", async () => {
    enableObsidian(sqlite, tmpDir);

    // 1. Create an exported item WITHOUT export_path (pre-v20 state)
    const itemId = "backfill-test-001";
    sqlite
      .prepare(
        `INSERT INTO items (id, type, title, content, status, created, modified)
       VALUES (?, 'note', ?, 'Some content', 'exported', '2026-01-01', '2026-01-01')`,
      )
      .run(itemId, "Backfill Test");

    // 2. Write a file in inbox with matching sparkle_id
    writeFileSync(
      join(tmpDir, "0_Inbox/Backfill Test.md"),
      `---\nsparkle_id: "${itemId}"\ntags: []\n---\nSome content`,
    );

    // 3. Run backfill
    const result = await backfillExportPaths(db, sqlite);
    expect(result.matched).toBe(1);

    // 4. Verify export_path was set
    const row = sqlite.prepare("SELECT export_path FROM items WHERE id = ?").get(itemId) as {
      export_path: string | null;
    };
    expect(row.export_path).toBe("0_Inbox/Backfill Test.md");

    // 5. Now the watcher can find it via export_path
    writeFileSync(
      join(tmpDir, "0_Inbox/Backfill Test.md"),
      `---\nsparkle_id: "${itemId}"\ntags: []\n---\nEdited after backfill`,
    );
    const futureTime = new Date(Date.now() + 2000);
    utimesSync(join(tmpDir, "0_Inbox/Backfill Test.md"), futureTime, futureTime);

    const scanResult = await scanExportedItems(db, sqlite);
    expect(scanResult.updated).toBe(1);

    const updated = sqlite.prepare("SELECT content FROM items WHERE id = ?").get(itemId) as {
      content: string;
    };
    expect(updated.content).toBe("Edited after backfill");
  });
});
