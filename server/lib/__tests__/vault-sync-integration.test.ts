/**
 * Integration-level test for the post-v23 vault-sync cycle:
 *   commitExportToVault (active → vault atomic move) + scanExportedItems
 *   (self-heal export_path via vault_files.sparkle_id).
 *
 * Asserts the v1.4.0 contract shift: Sparkle does NOT round-trip content from
 * the .md file back into items_vault.content_snippet — the vault is the source
 * of truth for exported content. The snippet is written once at export time
 * and is immutable thereafter (except by re-export from the same Sparkle row,
 * which requires the row to exist in items_active — a flow we don't cover here).
 *
 * fs.stat is mocked so we control "file exists" vs "file missing" per test
 * without touching the real filesystem.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { eq } from "drizzle-orm";

const { mockStat, mockLogger } = vi.hoisted(() => ({
  mockStat: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("node:fs/promises", () => ({
  stat: (...args: unknown[]) => mockStat(...args),
}));

vi.mock("../logger.js", () => ({ logger: mockLogger }));

// Import AFTER mocks.
import { scanExportedItems, clearMissCountCache } from "../vault-watcher.js";
import { commitExportToVault } from "../export.js";
import { createTestDb } from "../../test-utils.js";
import { itemsActive, itemsVault } from "../../db/schema.js";

const VAULT_PATH = "/fake/vault";

function enableObsidian(sqlite: ReturnType<typeof createTestDb>["sqlite"]): void {
  sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'obsidian_enabled'").run("true");
  sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'obsidian_vault_path'").run(VAULT_PATH);
}

function enoentError(): NodeJS.ErrnoException {
  const err = new Error("ENOENT: no such file") as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return err;
}

function mockStatByPath(
  behaviours: Record<string, "exists" | "enoent">,
  defaultBehaviour: "enoent" | "exists" = "enoent",
): void {
  mockStat.mockImplementation((path: string) => {
    const behaviour = behaviours[path] ?? defaultBehaviour;
    if (behaviour === "exists") return Promise.resolve();
    return Promise.reject(enoentError());
  });
}

/**
 * Seed items_active with a permanent note ready for export.
 * Returns the id and the content (so assertions can compare against the snippet).
 */
function seedActiveForExport(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  overrides: { id?: string; title?: string; content?: string } = {},
): { id: string; title: string; content: string } {
  const id = overrides.id ?? uuidv4();
  const title = overrides.title ?? "Exportable Note";
  const content = overrides.content ?? "First line\nSecond line";
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO items_active
         (id, title, type, status, content, tags, aliases, origin, source,
          category_id, is_private, created, modified)
       VALUES (?, ?, 'note', 'permanent', ?, '[]', '[]', 'app', NULL, NULL, 0, ?, ?)`,
    )
    .run(id, title, content, now, now);
  return { id, title, content };
}

function exportItemPayload(seed: { id: string; title: string; content: string }) {
  return {
    id: seed.id,
    title: seed.title,
    category_id: null,
    tags: "[]",
    aliases: "[]",
    source: null,
    origin: "app",
    created: "2026-01-01T00:00:00.000Z",
    is_private: 0,
    content: seed.content,
  };
}

describe("vault sync integration (commitExportToVault + scanExportedItems)", () => {
  let db: ReturnType<typeof createTestDb>["db"];
  let sqlite: ReturnType<typeof createTestDb>["sqlite"];

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
    mockStat.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.info.mockReset();
    mockLogger.error.mockReset();
    mockLogger.fatal.mockReset();
    clearMissCountCache();
  });

  it("full export + scan with file present → no patch, snippet unchanged (vault = source of truth)", async () => {
    enableObsidian(sqlite);
    const seed = seedActiveForExport(sqlite, { content: "Original body" });
    const exportPath = "0_Inbox/Exportable Note.md";

    commitExportToVault(sqlite, exportItemPayload(seed), exportPath);

    // After commit: active row gone, vault row present with snippet = content.
    const active = db.select().from(itemsActive).where(eq(itemsActive.id, seed.id)).get();
    expect(active).toBeUndefined();
    const vaultBefore = db.select().from(itemsVault).where(eq(itemsVault.id, seed.id)).get()!;
    expect(vaultBefore.content_snippet).toBe("Original body");
    expect(vaultBefore.export_path).toBe(exportPath);

    // Scan with fs.stat resolving → everything quiet, no patch.
    mockStatByPath({ [join(VAULT_PATH, exportPath)]: "exists" });
    const result = await scanExportedItems(db, sqlite);

    expect(result).toEqual({ scanned: 1, patched: 0, errors: 0 });

    // export_path + content_snippet unchanged.
    const vaultAfter = db.select().from(itemsVault).where(eq(itemsVault.id, seed.id)).get()!;
    expect(vaultAfter.export_path).toBe(exportPath);
    expect(vaultAfter.content_snippet).toBe("Original body");
  });

  it("empty items_vault → scan returns all-zero, no stat calls", async () => {
    enableObsidian(sqlite);

    const result = await scanExportedItems(db, sqlite);

    expect(result).toEqual({ scanned: 0, patched: 0, errors: 0 });
    expect(mockStat).not.toHaveBeenCalled();
  });

  it("post-export self-heal: file moved in vault → second scan patches export_path via vault_files.sparkle_id", async () => {
    enableObsidian(sqlite);
    const seed = seedActiveForExport(sqlite, { content: "Body before move" });
    const originalPath = "0_Inbox/Original.md";
    const renamedPath = "Archive/Renamed.md";

    commitExportToVault(sqlite, exportItemPayload(seed), originalPath);

    // Simulate vault-scanner having indexed the renamed file with the same
    // sparkle_id (the user moved/renamed .md in Obsidian; vault-scanner ran
    // first, vault-watcher runs second).
    sqlite
      .prepare(
        `INSERT INTO vault_files (path, title, content, mtime, content_hash, sparkle_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(renamedPath, "Renamed", "Body before move", Date.now(), "hash-x", seed.id);

    // First scan: ENOENT on original path → debounced (DEBUG).
    mockStatByPath({ [join(VAULT_PATH, originalPath)]: "enoent" });
    const firstResult = await scanExportedItems(db, sqlite);
    expect(firstResult).toEqual({ scanned: 1, patched: 0, errors: 0 });
    expect(mockLogger.debug).toHaveBeenCalledTimes(1);

    // Second scan: still ENOENT → self-heal via vault_files.sparkle_id.
    const secondResult = await scanExportedItems(db, sqlite);
    expect(secondResult).toEqual({ scanned: 1, patched: 1, errors: 0 });

    const vault = db.select().from(itemsVault).where(eq(itemsVault.id, seed.id)).get()!;
    expect(vault.export_path).toBe(renamedPath);
    // content_snippet is STILL the one from commit time — watcher does not
    // round-trip the vault file's content into the snippet.
    expect(vault.content_snippet).toBe("Body before move");
  });

  it("content_snippet is immutable across re-scans — user editing the vault .md does NOT propagate back", async () => {
    enableObsidian(sqlite);
    const seed = seedActiveForExport(sqlite, { content: "Sparkle snippet" });
    const exportPath = "0_Inbox/Note.md";

    commitExportToVault(sqlite, exportItemPayload(seed), exportPath);

    // Simulate vault-scanner having picked up the file with DIFFERENT content
    // (user edited the .md in Obsidian after export).
    sqlite
      .prepare(
        `INSERT INTO vault_files (path, title, content, mtime, content_hash, sparkle_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        exportPath,
        "Note",
        "User edited this in Obsidian — totally different",
        Date.now(),
        "hash-edited",
        seed.id,
      );

    mockStatByPath({ [join(VAULT_PATH, exportPath)]: "exists" });
    await scanExportedItems(db, sqlite);
    await scanExportedItems(db, sqlite);
    await scanExportedItems(db, sqlite);

    const vault = db.select().from(itemsVault).where(eq(itemsVault.id, seed.id)).get()!;
    // Proves v1.4.0 "removed content sync" contract: snippet remains what
    // commitExportToVault wrote, not what the .md currently says.
    expect(vault.content_snippet).toBe("Sparkle snippet");
  });
});
