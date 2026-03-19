import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs wrapper (used by vault.ts instead of node:fs directly)
vi.mock("../fs.js", () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock client
vi.mock("../client.js", () => ({
  getSettings: vi.fn(),
}));

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "../fs.js";
import { getSettings } from "../client.js";
import {
  parseFrontmatter,
  extractBody,
  resolveVaultPath,
  getVaultPath,
  findBySparkleId,
  readVaultFileByPath,
  writeVaultFileByPath,
  _resetCache,
  _resetIndex,
} from "../vault.js";

const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockGetSettings = vi.mocked(getSettings);

beforeEach(() => {
  vi.clearAllMocks();
  _resetCache();
  _resetIndex();
});

// --- parseFrontmatter ---

describe("parseFrontmatter", () => {
  it("parses basic key-value pairs", () => {
    const content = `---
sparkle_id: "cbe1a447-dd5a-405f-8959-f1bd8f699046"
created: 2026-03-17T14:00:00
origin: web
---

# Title`;
    const fm = parseFrontmatter(content);
    expect(fm.sparkle_id).toBe("cbe1a447-dd5a-405f-8959-f1bd8f699046");
    expect(fm.created).toBe("2026-03-17T14:00:00");
    expect(fm.origin).toBe("web");
  });

  it("parses YAML arrays (tags, aliases)", () => {
    const content = `---
tags:
  - ai
  - research
aliases:
  - "ML"
  - "machine learning"
---

Body`;
    const fm = parseFrontmatter(content);
    expect(fm.tags).toEqual(["ai", "research"]);
    expect(fm.aliases).toEqual(["ML", "machine learning"]);
  });

  it("returns empty object for content without frontmatter", () => {
    expect(parseFrontmatter("# Just a heading\n\nBody")).toEqual({});
    expect(parseFrontmatter("")).toEqual({});
  });

  it("handles quoted values with escaped characters", () => {
    const content = `---
category: "My \\"Category\\""
source: "https://example.com"
---`;
    const fm = parseFrontmatter(content);
    expect(fm.category).toBe('My \\"Category\\"');
    expect(fm.source).toBe("https://example.com");
  });

  it("handles mixed quoted and unquoted values", () => {
    const content = `---
sparkle_id: "abc-123"
priority: high
due: 2026-03-15
---`;
    const fm = parseFrontmatter(content);
    expect(fm.sparkle_id).toBe("abc-123");
    expect(fm.priority).toBe("high");
    expect(fm.due).toBe("2026-03-15");
  });
});

// --- extractBody ---

describe("extractBody", () => {
  it("removes frontmatter and trims", () => {
    const content = `---
sparkle_id: "abc"
---

# Title

Body content here.`;
    expect(extractBody(content)).toBe("# Title\n\nBody content here.");
  });

  it("returns full content when no frontmatter", () => {
    expect(extractBody("# Title\n\nBody")).toBe("# Title\n\nBody");
  });
});

// --- resolveVaultPath ---

describe("resolveVaultPath", () => {
  it("resolves valid relative paths", () => {
    const result = resolveVaultPath("/vault", "notes/test.md");
    expect(result).toBe("/vault/notes/test.md");
  });

  it("blocks path traversal with ..", () => {
    expect(() => resolveVaultPath("/vault", "../etc/passwd")).toThrow("outside the vault");
    expect(() => resolveVaultPath("/vault", "notes/../../etc/passwd")).toThrow(
      "outside the vault",
    );
  });

  it("allows vault root itself", () => {
    const result = resolveVaultPath("/vault", ".");
    expect(result).toBe("/vault");
  });
});

// --- getVaultPath ---

describe("getVaultPath", () => {
  it("fetches and caches vault path from settings", async () => {
    mockGetSettings.mockResolvedValue({
      obsidian_enabled: "true",
      obsidian_vault_path: "/my/vault",
    });

    const path1 = await getVaultPath();
    const path2 = await getVaultPath();

    expect(path1).toBe("/my/vault");
    expect(path2).toBe("/my/vault");
    expect(mockGetSettings).toHaveBeenCalledTimes(1);
  });

  it("throws when Obsidian is not enabled", async () => {
    mockGetSettings.mockResolvedValue({
      obsidian_enabled: "false",
      obsidian_vault_path: "/my/vault",
    });

    await expect(getVaultPath()).rejects.toThrow("not enabled");
  });

  it("throws when vault path is empty", async () => {
    mockGetSettings.mockResolvedValue({
      obsidian_enabled: "true",
      obsidian_vault_path: "",
    });

    await expect(getVaultPath()).rejects.toThrow("not configured");
  });
});

// --- findBySparkleId ---

describe("findBySparkleId", () => {
  const VAULT = "/my/vault";

  function setupVault() {
    mockGetSettings.mockResolvedValue({
      obsidian_enabled: "true",
      obsidian_vault_path: VAULT,
    });
  }

  function mockDirEntries(entries: { name: string; isDir: boolean }[]) {
    mockReaddirSync.mockReturnValue(
      entries.map((e) => ({
        name: e.name,
        isDirectory: () => e.isDir,
        isFile: () => !e.isDir,
      })) as never,
    );
  }

  it("finds file by sparkle_id after index build", async () => {
    setupVault();
    mockDirEntries([{ name: "note.md", isDir: false }]);
    mockReadFileSync.mockReturnValue(`---\nsparkle_id: "abc-123"\n---\n\n# Note`);
    mockExistsSync.mockReturnValue(true);

    const result = await findBySparkleId("abc-123");
    expect(result).not.toBeNull();
    expect(result!.path).toBe("/my/vault/note.md");
    expect(result!.content).toContain("abc-123");
  });

  it("returns null when sparkle_id not found", async () => {
    setupVault();
    mockDirEntries([{ name: "note.md", isDir: false }]);
    mockReadFileSync.mockReturnValue(`---\nsparkle_id: "other-id"\n---\n\n# Note`);

    const result = await findBySparkleId("abc-123");
    expect(result).toBeNull();
  });

  it("skips dotfiles and dotdirectories", async () => {
    setupVault();
    mockDirEntries([
      { name: ".obsidian", isDir: true },
      { name: ".DS_Store", isDir: false },
      { name: "note.md", isDir: false },
    ]);
    mockReadFileSync.mockReturnValue(`---\nsparkle_id: "abc-123"\n---\n\n# Note`);
    mockExistsSync.mockReturnValue(true);

    const result = await findBySparkleId("abc-123");
    expect(result).not.toBeNull();
    expect(result!.path).toBe("/my/vault/note.md");
    // .DS_Store is not a .md file, .obsidian starts with dot — only note.md is read
    // Called twice: once during buildIndex scan, once to return content
    expect(mockReadFileSync).toHaveBeenCalledTimes(2);
  });
});

// --- readVaultFileByPath ---

describe("readVaultFileByPath", () => {
  it("reads and parses a vault file", async () => {
    mockGetSettings.mockResolvedValue({
      obsidian_enabled: "true",
      obsidian_vault_path: "/vault",
    });
    mockReadFileSync.mockReturnValue(
      `---\nsparkle_id: "abc"\ntags:\n  - test\n---\n\n# Title\n\nBody`,
    );

    const file = await readVaultFileByPath("notes/test.md");
    expect(file.path).toBe("notes/test.md");
    expect(file.frontmatter.sparkle_id).toBe("abc");
    expect(file.frontmatter.tags).toEqual(["test"]);
    expect(file.body).toBe("# Title\n\nBody");
  });

  it("throws when file not found", async () => {
    mockGetSettings.mockResolvedValue({
      obsidian_enabled: "true",
      obsidian_vault_path: "/vault",
    });
    const enoent = new Error("ENOENT: no such file") as NodeJS.ErrnoException;
    enoent.code = "ENOENT";
    mockReadFileSync.mockImplementation(() => {
      throw enoent;
    });

    await expect(readVaultFileByPath("nonexistent.md")).rejects.toThrow("File not found");
  });
});

// --- writeVaultFileByPath ---

describe("writeVaultFileByPath", () => {
  it("writes content and creates parent dirs", async () => {
    mockGetSettings.mockResolvedValue({
      obsidian_enabled: "true",
      obsidian_vault_path: "/vault",
    });
    mockExistsSync.mockReturnValue(false);

    const result = await writeVaultFileByPath("new/folder/note.md", "# New Note");
    expect(result).toBe("new/folder/note.md");
    expect(mockMkdirSync).toHaveBeenCalledWith("/vault/new/folder", { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "/vault/new/folder/note.md",
      "# New Note",
      "utf-8",
    );
  });

  it("updates sparkle_id index when writing a file with sparkle_id", async () => {
    mockGetSettings.mockResolvedValue({
      obsidian_enabled: "true",
      obsidian_vault_path: "/vault",
    });
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('---\nsparkle_id: "new-id"\n---\n\n# Note');

    await writeVaultFileByPath(
      "note.md",
      '---\nsparkle_id: "new-id"\n---\n\n# Note',
    );

    // findBySparkleId should find it from the index without full rebuild
    const found = await findBySparkleId("new-id");
    expect(found).not.toBeNull();
    expect(found!.path).toBe("/vault/note.md");
  });
});
