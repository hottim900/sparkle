import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs wrapper (used by vault.ts instead of node:fs directly)
vi.mock("../fs.js", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn(),
}));

// Mock client
vi.mock("../client.js", () => ({
  getSettings: vi.fn(),
}));

import { readFile, readdir, writeFile, mkdir, access } from "../fs.js";
import { getSettings } from "../client.js";
import {
  parseFrontmatter,
  extractBody,
  resolveVaultPath,
  getVaultPath,
  findBySparkleId,
  readVaultFileByPath,
  writeVaultFileBySparkleId,
  writeVaultFileByPath,
  searchVault,
  listVault,
  _resetCache,
  _resetIndex,
} from "../vault.js";

const mockReadFile = vi.mocked(readFile);
const mockReaddir = vi.mocked(readdir);
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);
const mockAccess = vi.mocked(access);
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
    mockReaddir.mockResolvedValue(
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
    mockReadFile.mockResolvedValue(`---\nsparkle_id: "abc-123"\n---\n\n# Note`);
    mockAccess.mockResolvedValue(undefined);

    const result = await findBySparkleId("abc-123");
    expect(result).not.toBeNull();
    expect(result!.path).toBe("/my/vault/note.md");
    expect(result!.content).toContain("abc-123");
  });

  it("returns null when sparkle_id not found", async () => {
    setupVault();
    mockDirEntries([{ name: "note.md", isDir: false }]);
    mockReadFile.mockResolvedValue(`---\nsparkle_id: "other-id"\n---\n\n# Note`);

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
    mockReadFile.mockResolvedValue(`---\nsparkle_id: "abc-123"\n---\n\n# Note`);
    mockAccess.mockResolvedValue(undefined);

    const result = await findBySparkleId("abc-123");
    expect(result).not.toBeNull();
    expect(result!.path).toBe("/my/vault/note.md");
    // .DS_Store is not a .md file, .obsidian starts with dot — only note.md is read
    // Called twice: once during buildIndex scan, once to return content
    expect(mockReadFile).toHaveBeenCalledTimes(2);
  });
});

// --- readVaultFileByPath ---

describe("readVaultFileByPath", () => {
  it("reads and parses a vault file", async () => {
    mockGetSettings.mockResolvedValue({
      obsidian_enabled: "true",
      obsidian_vault_path: "/vault",
    });
    mockReadFile.mockResolvedValue(
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
    mockReadFile.mockRejectedValue(enoent);

    await expect(readVaultFileByPath("nonexistent.md")).rejects.toThrow("File not found");
  });
});

// --- writeVaultFileBySparkleId ---

describe("writeVaultFileBySparkleId", () => {
  const SPARKLE_ID = "cbe1a447-dd5a-405f-8959-f1bd8f699046";

  function setupFindable() {
    mockGetSettings.mockResolvedValue({
      obsidian_enabled: "true",
      obsidian_vault_path: "/vault",
    });
    // Seed the index so findBySparkleId resolves without walking the filesystem
    mockReadFile.mockResolvedValue(
      `---\nsparkle_id: "${SPARKLE_ID}"\n---\n\n# Old Content`,
    );
    // readdir for buildIndex
    mockReaddir.mockResolvedValue([
      { name: "note.md", isFile: () => true, isDirectory: () => false },
    ] as never);
  }

  it("rejects content without sparkle_id in frontmatter", async () => {
    setupFindable();
    // Prime the index
    await findBySparkleId(SPARKLE_ID);

    await expect(
      writeVaultFileBySparkleId(SPARKLE_ID, "# No frontmatter at all"),
    ).rejects.toThrow("missing sparkle_id");

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("accepts content with matching sparkle_id in frontmatter", async () => {
    setupFindable();
    await findBySparkleId(SPARKLE_ID);
    mockWriteFile.mockResolvedValue(undefined);

    const result = await writeVaultFileBySparkleId(
      SPARKLE_ID,
      `---\nsparkle_id: "${SPARKLE_ID}"\n---\n\n# Updated`,
    );

    expect(mockWriteFile).toHaveBeenCalled();
    expect(result).toBe("note.md");
  });
});

// --- writeVaultFileByPath ---

describe("writeVaultFileByPath", () => {
  it("writes content and creates parent dirs", async () => {
    mockGetSettings.mockResolvedValue({
      obsidian_enabled: "true",
      obsidian_vault_path: "/vault",
    });
    // access rejects = dir does not exist
    mockAccess.mockRejectedValue(new Error("ENOENT"));
    mockMkdir.mockResolvedValue(undefined as never);
    mockWriteFile.mockResolvedValue(undefined);

    const result = await writeVaultFileByPath("new/folder/note.md", "# New Note");
    expect(result).toBe("new/folder/note.md");
    expect(mockMkdir).toHaveBeenCalledWith("/vault/new/folder", { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(
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
    // access resolves = dir exists
    mockAccess.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('---\nsparkle_id: "new-id"\n---\n\n# Note');

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

// --- searchVault ---

describe("searchVault", () => {
  const VAULT = "/my/vault";

  function setupVault() {
    mockGetSettings.mockResolvedValue({
      obsidian_enabled: "true",
      obsidian_vault_path: VAULT,
    });
  }

  function mockDirEntries(entries: { name: string; isDir: boolean }[]) {
    mockReaddir.mockResolvedValue(
      entries.map((e) => ({
        name: e.name,
        isDirectory: () => e.isDir,
        isFile: () => !e.isDir,
      })) as never,
    );
  }

  it("finds matches with context lines", async () => {
    setupVault();
    mockDirEntries([{ name: "note.md", isDir: false }]);
    mockReadFile.mockResolvedValue(
      "---\nsparkle_id: \"abc\"\n---\n\nline one\nline two\nfind me here\nline four\nline five",
    );

    const results = await searchVault("find me");
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe("note.md");
    expect(results[0].matches).toHaveLength(1);
    expect(results[0].matches[0].line).toBe(7);
    expect(results[0].matches[0].text).toBe("find me here");
    expect(results[0].matches[0].context_before).toEqual(["line one", "line two"]);
    expect(results[0].matches[0].context_after).toEqual(["line four", "line five"]);
    expect(results[0].frontmatter.sparkle_id).toBe("abc");
  });

  it("performs case-insensitive search", async () => {
    setupVault();
    mockDirEntries([{ name: "note.md", isDir: false }]);
    mockReadFile.mockResolvedValue("# Title\n\nHello WORLD");

    const results = await searchVault("hello world");
    expect(results).toHaveLength(1);
    expect(results[0].matches[0].text).toBe("Hello WORLD");
  });

  it("respects path option for subdirectory search", async () => {
    setupVault();
    mockDirEntries([{ name: "sub.md", isDir: false }]);
    mockReadFile.mockResolvedValue("match here");

    const results = await searchVault("match", { path: "Projects" });
    expect(results).toHaveLength(1);
    // readdir should have been called with the resolved subdirectory
    expect(mockReaddir).toHaveBeenCalledWith(
      "/my/vault/Projects",
      expect.objectContaining({ withFileTypes: true }),
    );
  });

  it("respects limit option", async () => {
    setupVault();
    // Return 3 files but set limit to 2
    mockReaddir.mockResolvedValue([
      { name: "a.md", isDirectory: () => false, isFile: () => true },
      { name: "b.md", isDirectory: () => false, isFile: () => true },
      { name: "c.md", isDirectory: () => false, isFile: () => true },
    ] as never);
    mockReadFile.mockResolvedValue("matching content");

    const results = await searchVault("matching", { limit: 2 });
    expect(results).toHaveLength(2);
  });

  it("returns empty array when no matches", async () => {
    setupVault();
    mockDirEntries([{ name: "note.md", isDir: false }]);
    mockReadFile.mockResolvedValue("nothing interesting here");

    const results = await searchVault("nonexistent");
    expect(results).toHaveLength(0);
  });
});

// --- listVault ---

describe("listVault", () => {
  const VAULT = "/my/vault";

  function setupVault() {
    mockGetSettings.mockResolvedValue({
      obsidian_enabled: "true",
      obsidian_vault_path: VAULT,
    });
  }

  it("lists all files recursively by default", async () => {
    setupVault();
    // walk calls readdir recursively — mock root then subdir
    mockReaddir
      .mockResolvedValueOnce([
        { name: "note.md", isDirectory: () => false, isFile: () => true },
        { name: "sub", isDirectory: () => true, isFile: () => false },
      ] as never)
      .mockResolvedValueOnce([
        { name: "deep.md", isDirectory: () => false, isFile: () => true },
      ] as never);
    mockReadFile.mockResolvedValue('---\nsparkle_id: "abc"\n---\n\n# Note');

    const result = await listVault();
    expect(result.files).toHaveLength(2);
    expect(result.directories).toHaveLength(0);
    // Files should be sorted by path
    expect(result.files[0].path).toBe("note.md");
    expect(result.files[1].path).toBe("sub/deep.md");
    expect(result.files[0].frontmatter.sparkle_id).toBe("abc");
  });

  it("lists files non-recursively with directories", async () => {
    setupVault();
    mockReaddir.mockResolvedValue([
      { name: "note.md", isDirectory: () => false, isFile: () => true },
      { name: "Projects", isDirectory: () => true, isFile: () => false },
      { name: "Archive", isDirectory: () => true, isFile: () => false },
    ] as never);
    mockReadFile.mockResolvedValue("# Simple note");

    const result = await listVault({ recursive: false });
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("note.md");
    expect(result.directories).toEqual(["Archive", "Projects"]);
  });

  it("skips dotfiles and dotdirectories", async () => {
    setupVault();
    mockReaddir.mockResolvedValue([
      { name: ".obsidian", isDirectory: () => true, isFile: () => false },
      { name: ".DS_Store", isDirectory: () => false, isFile: () => true },
      { name: "note.md", isDirectory: () => false, isFile: () => true },
    ] as never);
    mockReadFile.mockResolvedValue("# Note");

    const result = await listVault({ recursive: false });
    expect(result.files).toHaveLength(1);
    expect(result.directories).toHaveLength(0);
  });

  it("respects limit option", async () => {
    setupVault();
    mockReaddir.mockResolvedValue([
      { name: "a.md", isDirectory: () => false, isFile: () => true },
      { name: "b.md", isDirectory: () => false, isFile: () => true },
      { name: "c.md", isDirectory: () => false, isFile: () => true },
    ] as never);
    mockReadFile.mockResolvedValue("content");

    const result = await listVault({ limit: 2 });
    expect(result.files).toHaveLength(2);
  });

  it("respects path option", async () => {
    setupVault();
    mockReaddir.mockResolvedValue([
      { name: "note.md", isDirectory: () => false, isFile: () => true },
    ] as never);
    mockReadFile.mockResolvedValue("content");

    await listVault({ path: "Projects", recursive: false });
    expect(mockReaddir).toHaveBeenCalledWith(
      "/my/vault/Projects",
      expect.objectContaining({ withFileTypes: true }),
    );
  });
});
