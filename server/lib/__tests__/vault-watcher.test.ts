import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";

// Mock node:fs/promises.stat — each test wires up the behaviour it wants.
// NOTE: vi.mock factories are hoisted to the top of the file. References to
// module-level consts from within the factory trigger TDZ errors, so we pull
// the mocks back out via vi.hoisted to make them safely usable.
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

// Import under test AFTER the mocks are registered.
import { scanExportedItems, clearMissCountCache } from "../vault-watcher.js";
import { createTestDb, insertVaultRow } from "../../test-utils.js";

const VAULT_PATH = "/fake/vault";

/**
 * Build an ENOENT error object shaped like a Node fs error so the watcher's
 * `(e as NodeJS.ErrnoException).code` branch picks it up.
 */
function enoentError(): NodeJS.ErrnoException {
  const err = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return err;
}

function eaccesError(): NodeJS.ErrnoException {
  const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
  err.code = "EACCES";
  return err;
}

/**
 * Configure the fs.stat mock from a path → behaviour map.
 * 'exists'  → resolve
 * 'enoent'  → reject with ENOENT
 * 'eacces'  → reject with EACCES
 */
function mockStatByPath(
  behaviours: Record<string, "exists" | "enoent" | "eacces">,
  defaultBehaviour: "enoent" | "exists" = "enoent",
): void {
  mockStat.mockImplementation((path: string) => {
    const behaviour = behaviours[path] ?? defaultBehaviour;
    if (behaviour === "exists") return Promise.resolve();
    if (behaviour === "eacces") return Promise.reject(eaccesError());
    return Promise.reject(enoentError());
  });
}

function enableObsidian(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  vaultPath = VAULT_PATH,
): void {
  sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'obsidian_enabled'").run("true");
  sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'obsidian_vault_path'").run(vaultPath);
}

// Local helper wraps the shared insertVaultRow; legacy tests used a `snippet`
// default rather than "" so keep that for test-readability.
function insertVaultItem(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  overrides: {
    id: string;
    export_path: string | null;
    title?: string;
    content_snippet?: string;
  },
): void {
  insertVaultRow(sqlite, {
    id: overrides.id,
    title: overrides.title ?? "Vault item",
    export_path: overrides.export_path,
    content_snippet: overrides.content_snippet ?? "snippet",
  });
}

function insertVaultFileRow(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  row: { path: string; sparkle_id: string | null; title?: string; content?: string },
): void {
  sqlite
    .prepare(
      `INSERT INTO vault_files (path, title, content, mtime, content_hash, sparkle_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.path,
      row.title ?? "File",
      row.content ?? "body",
      Date.now(),
      `hash-${row.path}`,
      row.sparkle_id,
    );
}

describe("vault-watcher.scanExportedItems", () => {
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
    // Process-level map — mandatory reset between tests.
    clearMissCountCache();
  });

  it("returns zero-result early when Obsidian is disabled", async () => {
    // Leave obsidian_enabled='false' (fresh-install default).
    insertVaultItem(sqlite, { id: "vault-a", export_path: "Inbox/a.md" });

    const result = await scanExportedItems(db, sqlite);

    expect(result).toEqual({ scanned: 0, patched: 0, errors: 0 });
    expect(mockStat).not.toHaveBeenCalled();
  });

  it("returns zero-result early when Obsidian is enabled but vault_path is empty", async () => {
    sqlite.prepare("UPDATE settings SET value = ? WHERE key = 'obsidian_enabled'").run("true");
    // obsidian_vault_path stays '' (fresh-install default).
    insertVaultItem(sqlite, { id: "vault-a", export_path: "Inbox/a.md" });

    const result = await scanExportedItems(db, sqlite);

    expect(result).toEqual({ scanned: 0, patched: 0, errors: 0 });
    expect(mockStat).not.toHaveBeenCalled();
  });

  it("file exists → no patch, miss count cleared", async () => {
    enableObsidian(sqlite);
    insertVaultItem(sqlite, { id: "vault-ok", export_path: "Inbox/ok.md" });
    mockStatByPath({ [join(VAULT_PATH, "Inbox/ok.md")]: "exists" });

    const result = await scanExportedItems(db, sqlite);

    expect(result).toEqual({ scanned: 1, patched: 0, errors: 0 });
    expect(mockStat).toHaveBeenCalledTimes(1);
    expect(mockLogger.debug).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();

    // export_path unchanged
    const row = sqlite
      .prepare("SELECT export_path FROM items_vault WHERE id = ?")
      .get("vault-ok") as { export_path: string };
    expect(row.export_path).toBe("Inbox/ok.md");
  });

  it("first ENOENT → debounce: DEBUG log, no patch, export_path unchanged", async () => {
    enableObsidian(sqlite);
    insertVaultItem(sqlite, { id: "vault-miss-1", export_path: "Inbox/miss.md" });
    mockStatByPath({}, "enoent");

    const result = await scanExportedItems(db, sqlite);

    expect(result).toEqual({ scanned: 1, patched: 0, errors: 0 });
    expect(mockLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).not.toHaveBeenCalled();

    const row = sqlite
      .prepare("SELECT export_path FROM items_vault WHERE id = ?")
      .get("vault-miss-1") as { export_path: string };
    expect(row.export_path).toBe("Inbox/miss.md");
  });

  it("second consecutive ENOENT with vault_files match → patches export_path (WARN)", async () => {
    enableObsidian(sqlite);
    insertVaultItem(sqlite, { id: "vault-renamed", export_path: "Inbox/old.md" });
    insertVaultFileRow(sqlite, { path: "Inbox/renamed.md", sparkle_id: "vault-renamed" });
    mockStatByPath({}, "enoent");

    // First scan: debounce (DEBUG, count=1).
    await scanExportedItems(db, sqlite);
    // Second scan: self-heal.
    const result = await scanExportedItems(db, sqlite);

    expect(result).toEqual({ scanned: 1, patched: 1, errors: 0 });
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0]?.[0]).toMatch(/self-healed/);

    const row = sqlite
      .prepare("SELECT export_path FROM items_vault WHERE id = ?")
      .get("vault-renamed") as { export_path: string };
    expect(row.export_path).toBe("Inbox/renamed.md");
  });

  it("second consecutive ENOENT, no vault_files match → WARN, export_path unchanged, not counted as patched", async () => {
    enableObsidian(sqlite);
    insertVaultItem(sqlite, { id: "vault-lost", export_path: "Inbox/lost.md" });
    mockStatByPath({}, "enoent");

    await scanExportedItems(db, sqlite);
    const result = await scanExportedItems(db, sqlite);

    expect(result).toEqual({ scanned: 1, patched: 0, errors: 0 });
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0]?.[0]).toMatch(/no vault_files match/);

    const row = sqlite
      .prepare("SELECT export_path FROM items_vault WHERE id = ?")
      .get("vault-lost") as { export_path: string };
    expect(row.export_path).toBe("Inbox/lost.md");
  });

  it("non-ENOENT error (EACCES) → increments errors, WARN, does not touch miss count", async () => {
    enableObsidian(sqlite);
    insertVaultItem(sqlite, { id: "vault-eacces", export_path: "Inbox/protected.md" });
    mockStatByPath({ [join(VAULT_PATH, "Inbox/protected.md")]: "eacces" });

    const result = await scanExportedItems(db, sqlite);

    expect(result).toEqual({ scanned: 1, patched: 0, errors: 1 });
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0]?.[0]).toMatch(/EACCES/);

    // Miss count NOT incremented — next scan on ENOENT should still be DEBUG (first miss).
    mockLogger.warn.mockReset();
    mockLogger.debug.mockReset();
    mockStatByPath({ [join(VAULT_PATH, "Inbox/protected.md")]: "enoent" });
    await scanExportedItems(db, sqlite);
    expect(mockLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("file reappears after first miss → miss count cleared, subsequent miss starts from DEBUG again", async () => {
    enableObsidian(sqlite);
    insertVaultItem(sqlite, { id: "vault-flaky", export_path: "Inbox/flaky.md" });
    const fullPath = join(VAULT_PATH, "Inbox/flaky.md");

    // Scan 1: ENOENT → miss count = 1, DEBUG log.
    mockStatByPath({ [fullPath]: "enoent" });
    await scanExportedItems(db, sqlite);
    expect(mockLogger.debug).toHaveBeenCalledTimes(1);

    // Scan 2: file back → count cleared.
    mockLogger.debug.mockReset();
    mockStatByPath({ [fullPath]: "exists" });
    await scanExportedItems(db, sqlite);
    expect(mockLogger.debug).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();

    // Scan 3: ENOENT again → should be DEBUG (treated as first miss, count=1).
    mockStatByPath({ [fullPath]: "enoent" });
    await scanExportedItems(db, sqlite);
    expect(mockLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("clearMissCountCache() resets state between scans", async () => {
    enableObsidian(sqlite);
    insertVaultItem(sqlite, { id: "vault-reset", export_path: "Inbox/reset.md" });
    mockStatByPath({}, "enoent");

    // Scan 1: miss count 1 (DEBUG).
    await scanExportedItems(db, sqlite);
    expect(mockLogger.debug).toHaveBeenCalledTimes(1);

    // Simulate "process restart" mid-test.
    clearMissCountCache();
    mockLogger.debug.mockReset();
    mockLogger.warn.mockReset();

    // Scan 2: without the clear this would be miss #2 (WARN); with it, it's miss #1 (DEBUG).
    await scanExportedItems(db, sqlite);
    expect(mockLogger.debug).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("skips rows with null export_path (counted in scanned, no stat call)", async () => {
    enableObsidian(sqlite);
    // Row with null export_path — watcher SELECT filters on isNotNull so this
    // row is NOT included; we add a second row with a path to sanity-check the count.
    insertVaultItem(sqlite, { id: "vault-null", export_path: null });
    insertVaultItem(sqlite, { id: "vault-ok-2", export_path: "Inbox/ok2.md" });
    mockStatByPath({ [join(VAULT_PATH, "Inbox/ok2.md")]: "exists" });

    const result = await scanExportedItems(db, sqlite);

    expect(result).toEqual({ scanned: 1, patched: 0, errors: 0 });
    expect(mockStat).toHaveBeenCalledTimes(1);
  });
});
