import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { createTestDb, insertActiveRow } from "../../test-utils.js";
import {
  sanitizeFilename,
  generateFrontmatter,
  generateMarkdown,
  exportToObsidian,
  yamlEscape,
  normalizeTags,
  resolveSparkleReferences,
  commitExportToVault,
  ExportableItem,
  ExportConfig,
} from "../export.js";

// ============================================================
// sanitizeFilename
// ============================================================
describe("sanitizeFilename", () => {
  it("replaces forbidden chars with dash", () => {
    expect(sanitizeFilename('a/b\\c:d*e?"f<g>h|i[j]k#l^m')).toBe("a-b-c-d-e-f-g-h-i-j-k-l-m");
  });

  it("collapses consecutive dashes", () => {
    expect(sanitizeFilename("a///b***c")).toBe("a-b-c");
  });

  it("strips leading dots", () => {
    expect(sanitizeFilename("...hidden")).toBe("hidden");
  });

  it("strips leading and trailing dashes", () => {
    expect(sanitizeFilename("---hello---")).toBe("hello");
  });

  it("strips leading dots followed by dashes", () => {
    expect(sanitizeFilename(".-.-test")).toBe("test");
  });

  it("truncates to 200 chars", () => {
    const long = "a".repeat(250);
    const result = sanitizeFilename(long);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it("strips trailing dash after truncation", () => {
    // Create a string that will have a dash right at position 200
    const base = "a".repeat(199) + "/b".repeat(50);
    const result = sanitizeFilename(base);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result.endsWith("-")).toBe(false);
  });

  it("returns 'untitled' for empty result", () => {
    expect(sanitizeFilename("")).toBe("untitled");
    expect(sanitizeFilename("///")).toBe("untitled");
    expect(sanitizeFilename("...")).toBe("untitled");
  });
});

// ============================================================
// yamlEscape
// ============================================================
describe("yamlEscape", () => {
  it("returns bare value for simple strings", () => {
    expect(yamlEscape("hello")).toBe("hello");
    expect(yamlEscape("web")).toBe("web");
    expect(yamlEscape("LINE")).toBe("LINE");
  });

  it("returns quoted empty string", () => {
    expect(yamlEscape("")).toBe('""');
  });

  it("quotes values with colons", () => {
    expect(yamlEscape("key: value")).toBe('"key: value"');
  });

  it("quotes values with hash", () => {
    expect(yamlEscape("tag#1")).toBe('"tag#1"');
  });

  it("escapes internal double quotes", () => {
    expect(yamlEscape('say "hello"')).toBe('"say \\"hello\\""');
  });

  it("escapes backslashes before quotes", () => {
    expect(yamlEscape("path\\file")).toBe('"path\\\\file"');
  });

  it("quotes values with single quotes", () => {
    expect(yamlEscape("it's")).toBe('"it\'s"');
  });

  it("quotes values with braces and brackets", () => {
    expect(yamlEscape("{obj}")).toBe('"{obj}"');
    expect(yamlEscape("[arr]")).toBe('"[arr]"');
  });

  it("quotes values with leading whitespace", () => {
    expect(yamlEscape(" leading")).toBe('" leading"');
  });

  it("quotes values with trailing whitespace", () => {
    expect(yamlEscape("trailing ")).toBe('"trailing "');
  });

  it("escapes newlines", () => {
    expect(yamlEscape("line1\nline2")).toBe('"line1\\nline2"');
  });

  it("escapes carriage returns", () => {
    expect(yamlEscape("a\rb")).toBe('"a\\rb"');
  });

  it("escapes tab characters", () => {
    expect(yamlEscape("a\tb")).toBe('"a\\tb"');
  });

  it("quotes YAML reserved words", () => {
    expect(yamlEscape("true")).toBe('"true"');
    expect(yamlEscape("false")).toBe('"false"');
    expect(yamlEscape("null")).toBe('"null"');
    expect(yamlEscape("yes")).toBe('"yes"');
    expect(yamlEscape("no")).toBe('"no"');
    expect(yamlEscape("on")).toBe('"on"');
    expect(yamlEscape("off")).toBe('"off"');
    expect(yamlEscape("~")).toBe('"~"');
  });

  it("quotes YAML reserved words case-insensitively", () => {
    expect(yamlEscape("True")).toBe('"True"');
    expect(yamlEscape("FALSE")).toBe('"FALSE"');
    expect(yamlEscape("Null")).toBe('"Null"');
  });

  it("does not quote partial matches of reserved words", () => {
    expect(yamlEscape("truthy")).toBe("truthy");
    expect(yamlEscape("nullable")).toBe("nullable");
  });
});

// ============================================================
// generateFrontmatter
// ============================================================
function makeItem(overrides: Partial<ExportableItem> = {}): ExportableItem {
  return {
    id: "test-id-123",
    title: "Test Title",
    content: "Some content",
    tags: "[]",
    aliases: "[]",
    source: null,
    created: "2026-01-15T08:30:00.000Z",
    modified: "2026-01-15T10:00:00.000Z",
    origin: "web",
    priority: null,
    due: null,
    ...overrides,
  };
}

describe("generateFrontmatter", () => {
  it("always includes sparkle_id, created, modified, origin", () => {
    const fm = generateFrontmatter(makeItem());
    expect(fm).toContain('sparkle_id: "test-id-123"');
    expect(fm).toContain("origin: web");
    expect(fm).toMatch(/^---\n/);
    expect(fm).toMatch(/\n---$/);
    // created and modified should be present
    expect(fm).toMatch(/created: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(fm).toMatch(/modified: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("omits empty tags", () => {
    const fm = generateFrontmatter(makeItem({ tags: "[]" }));
    expect(fm).not.toContain("tags:");
  });

  it("includes non-empty tags", () => {
    const fm = generateFrontmatter(makeItem({ tags: '["work","urgent"]' }));
    expect(fm).toContain("tags:");
    expect(fm).toContain("  - work");
    expect(fm).toContain("  - urgent");
  });

  it("omits empty aliases", () => {
    const fm = generateFrontmatter(makeItem({ aliases: "[]" }));
    expect(fm).not.toContain("aliases:");
  });

  it("includes non-empty aliases", () => {
    const fm = generateFrontmatter(makeItem({ aliases: '["Alias One","Alias Two"]' }));
    expect(fm).toContain("aliases:");
    expect(fm).toContain('  - "Alias One"');
    expect(fm).toContain('  - "Alias Two"');
  });

  it("omits null source", () => {
    const fm = generateFrontmatter(makeItem({ source: null }));
    expect(fm).not.toContain("source:");
  });

  it("includes non-null source", () => {
    const fm = generateFrontmatter(makeItem({ source: "https://example.com" }));
    expect(fm).toContain('source: "https://example.com"');
  });

  it("omits null priority", () => {
    const fm = generateFrontmatter(makeItem({ priority: null }));
    expect(fm).not.toContain("priority:");
  });

  it("includes non-null priority", () => {
    const fm = generateFrontmatter(makeItem({ priority: "high" }));
    expect(fm).toContain("priority: high");
  });

  it("omits null due", () => {
    const fm = generateFrontmatter(makeItem({ due: null }));
    expect(fm).not.toContain("due:");
  });

  it("includes non-null due", () => {
    const fm = generateFrontmatter(makeItem({ due: "2026-03-01" }));
    expect(fm).toContain("due: 2026-03-01");
  });

  it("uses local time with timezone offset (no Z suffix)", () => {
    const fm = generateFrontmatter(makeItem());
    const lines = fm.split("\n");
    const createdLine = lines.find((l) => l.startsWith("created:"));
    const modifiedLine = lines.find((l) => l.startsWith("modified:"));
    expect(createdLine).toBeDefined();
    expect(modifiedLine).toBeDefined();
    expect(createdLine).not.toContain("Z");
    expect(modifiedLine).not.toContain("Z");
    // Should contain timezone offset like +08:00 or -05:00
    expect(createdLine).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(modifiedLine).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  // --- YAML escaping (DEF-021) ---

  it("escapes tags containing colons (normalized)", () => {
    const fm = generateFrontmatter(makeItem({ tags: '["key: value"]' }));
    expect(fm).toContain('  - "key:-value"');
  });

  it("escapes tags containing hash (normalized to lowercase)", () => {
    const fm = generateFrontmatter(makeItem({ tags: '["C#"]' }));
    expect(fm).toContain('  - "c#"');
  });

  it("escapes aliases containing double quotes", () => {
    const fm = generateFrontmatter(makeItem({ aliases: '["say \\"hello\\""]' }));
    expect(fm).toContain('  - "say \\"hello\\""');
  });

  it("escapes source containing double quotes", () => {
    const fm = generateFrontmatter(makeItem({ source: 'https://example.com/path?a="b"' }));
    expect(fm).toContain('source: "https://example.com/path?a=\\"b\\""');
  });

  it("handles empty origin as quoted empty string", () => {
    const fm = generateFrontmatter(makeItem({ origin: "" }));
    expect(fm).toContain('origin: ""');
  });

  it("handles null origin as quoted empty string", () => {
    const fm = generateFrontmatter(makeItem({ origin: null }));
    expect(fm).toContain('origin: ""');
  });

  it("renders simple origin without quotes", () => {
    const fm = generateFrontmatter(makeItem({ origin: "web" }));
    expect(fm).toContain("origin: web");
  });

  // --- JSON parse errors (DEF-022) ---

  it("throws on invalid tags JSON", () => {
    expect(() => generateFrontmatter(makeItem({ tags: "not-json" }))).toThrow(
      /Failed to parse tags JSON/,
    );
  });

  it("throws on invalid aliases JSON", () => {
    expect(() => generateFrontmatter(makeItem({ aliases: "{bad}" }))).toThrow(
      /Failed to parse aliases JSON/,
    );
  });

  it("includes item ID in tags JSON parse error", () => {
    expect(() => generateFrontmatter(makeItem({ id: "abc-123", tags: "broken" }))).toThrow(
      /abc-123/,
    );
  });

  it("includes raw value in aliases JSON parse error", () => {
    expect(() => generateFrontmatter(makeItem({ aliases: "oops" }))).toThrow(/oops/);
  });
});

// ============================================================
// generateMarkdown
// ============================================================
describe("generateMarkdown", () => {
  it("adds H1 title when content has no H1", () => {
    const item = makeItem({ title: "My Note", content: "Hello world" });
    const md = generateMarkdown(item);
    const parts = md.split("---");
    const afterFrontmatter = parts[2];
    expect(afterFrontmatter).toBe("\n\n# My Note\n\nHello world\n");
  });

  it("skips auto H1 when content starts with H1", () => {
    const item = makeItem({ title: "My Note", content: "# Existing Title\n\nBody text" });
    const md = generateMarkdown(item);
    expect(md).not.toContain("# My Note");
    expect(md).toContain("# Existing Title");
  });

  it("still adds H1 when content starts with H2", () => {
    const item = makeItem({ title: "My Note", content: "## Subtitle\n\nBody" });
    const md = generateMarkdown(item);
    expect(md).toContain("# My Note");
    expect(md).toContain("## Subtitle");
  });

  it("handles leading whitespace before H1", () => {
    const item = makeItem({ title: "My Note", content: "\n\n# Existing Title\n\nBody" });
    const md = generateMarkdown(item);
    expect(md).not.toContain("# My Note");
    expect(md).toContain("# Existing Title");
  });

  it("adds H1 when content is empty", () => {
    const item = makeItem({ title: "Empty", content: "" });
    const md = generateMarkdown(item);
    expect(md).toContain("# Empty\n\n\n");
  });

  it("adds H1 when content is null", () => {
    const item = makeItem({ title: "Null", content: null });
    const md = generateMarkdown(item);
    expect(md).toContain("# Null");
  });

  it("skips auto H1 even when H1 differs from title", () => {
    const item = makeItem({ title: "My Note", content: "# Different Title\n\nBody" });
    const md = generateMarkdown(item);
    expect(md).not.toContain("# My Note");
    expect(md).toContain("# Different Title");
  });
});

// ============================================================
// normalizeTags
// ============================================================
describe("normalizeTags", () => {
  it("deduplicates after normalization", () => {
    expect(normalizeTags(["claude code", "claude-code"])).toEqual(["claude-code"]);
  });

  it("lowercases and deduplicates", () => {
    expect(normalizeTags(["Ai Agent", "AI-agent"])).toEqual(["ai-agent"]);
  });

  it("preserves first occurrence on dedup", () => {
    expect(normalizeTags(["tag1", "TAG1", "Tag1"])).toEqual(["tag1"]);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeTags([])).toEqual([]);
  });

  it("preserves Chinese tags unchanged", () => {
    expect(normalizeTags(["中文標籤"])).toEqual(["中文標籤"]);
  });

  it("preserves special chars, only lowercases", () => {
    expect(normalizeTags(["C++", "Node.js"])).toEqual(["c++", "node.js"]);
  });

  it("integrates with generateFrontmatter", () => {
    const fm = generateFrontmatter(
      makeItem({ tags: '["claude code", "claude-code", "Ai Agent"]' }),
    );
    expect(fm).toContain("  - claude-code");
    expect(fm).toContain("  - ai-agent");
    // Should not contain duplicate
    const lines = fm.split("\n").filter((l) => l.includes("claude-code"));
    expect(lines).toHaveLength(1);
  });
});

// ============================================================
// resolveSparkleReferences
// ============================================================
describe("resolveSparkleReferences", () => {
  it("resolves matching ID to wikilink", () => {
    const lookup = () => ({ title: "My Note Title" });
    expect(resolveSparkleReferences("參見筆記（a9e1f98d）的內容", lookup)).toBe(
      "參見[[My Note Title]]的內容",
    );
  });

  it("preserves original when lookup returns null", () => {
    const lookup = () => null;
    expect(resolveSparkleReferences("參見筆記（deadbeef）", lookup)).toBe("參見筆記（deadbeef）");
  });

  it("returns content unchanged when no references", () => {
    const lookup = vi.fn();
    const content = "No references here";
    expect(resolveSparkleReferences(content, lookup)).toBe(content);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("resolves multiple references", () => {
    const lookup = (id: string) => {
      if (id === "aaaa1111") return { title: "Note A" };
      if (id === "bbbb2222") return { title: "Note B" };
      return null;
    };
    const result = resolveSparkleReferences("見筆記（aaaa1111）和筆記（bbbb2222）", lookup);
    expect(result).toBe("見[[Note A]]和[[Note B]]");
  });

  it("preserves original when lookup throws (ambiguous prefix)", () => {
    const lookup = () => {
      throw new Error("Ambiguous ID prefix");
    };
    expect(resolveSparkleReferences("筆記（abcd）", lookup)).toBe("筆記（abcd）");
  });

  it("preserves original for private items (lookup returns null)", () => {
    const lookup = () => null;
    expect(resolveSparkleReferences("筆記（abcd1234）", lookup)).toBe("筆記（abcd1234）");
  });

  it("sanitizes wikilink-breaking chars in titles", () => {
    const lookup = () => ({ title: "Note with ]] and [[ and | and\nnewline" });
    expect(resolveSparkleReferences("筆記（abcd1234）", lookup)).toBe(
      "[[Note with ） and （ and - and newline]]",
    );
  });

  it("resolves adjacent references independently", () => {
    const lookup = (id: string) => {
      if (id === "aaaa") return { title: "First" };
      if (id === "bbbb") return { title: "Second" };
      return null;
    };
    expect(resolveSparkleReferences("筆記（aaaa）和筆記（bbbb）", lookup)).toBe(
      "[[First]]和[[Second]]",
    );
  });
});

// ============================================================
// exportToObsidian
// ============================================================
describe("exportToObsidian", () => {
  let tempDir: string;
  let config: ExportConfig;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sparkle-export-test-"));
    config = {
      vaultPath: tempDir,
      inboxFolder: "0_Inbox",
      exportMode: "overwrite",
    };
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes file to vault inbox folder", async () => {
    const item = makeItem({ title: "Test Export" });
    const result = await exportToObsidian(item, config);

    expect(result.path).toBe("0_Inbox/Test Export.md");
    const filePath = join(tempDir, "0_Inbox", "Test Export.md");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("# Test Export");
    expect(content).toContain('sparkle_id: "test-id-123"');
  });

  it("creates directory if it does not exist", async () => {
    config.inboxFolder = "nested/deep/folder";
    const item = makeItem({ title: "Nested" });
    const result = await exportToObsidian(item, config);

    expect(result.path).toBe("nested/deep/folder/Nested.md");
    const content = readFileSync(join(tempDir, "nested/deep/folder", "Nested.md"), "utf-8");
    expect(content).toContain("# Nested");
  });

  it("handles collision in new mode by appending timestamp", async () => {
    config.exportMode = "new";
    const item = makeItem({ title: "Collision" });

    // Create the file first so there's a collision
    const inboxDir = join(tempDir, "0_Inbox");
    mkdirSync(inboxDir, { recursive: true });
    writeFileSync(join(inboxDir, "Collision.md"), "existing", "utf-8");

    const result = await exportToObsidian(item, config);

    // Should have a timestamp suffix instead of the original filename
    expect(result.path).not.toBe("0_Inbox/Collision.md");
    expect(result.path).toMatch(/^0_Inbox\/Collision \(\d{8}-\d{6}\)\.md$/);
  });

  it("overwrites existing file in overwrite mode", async () => {
    config.exportMode = "overwrite";
    const item = makeItem({ title: "Overwrite Me" });

    // Create the file first
    const inboxDir = join(tempDir, "0_Inbox");
    mkdirSync(inboxDir, { recursive: true });
    writeFileSync(join(inboxDir, "Overwrite Me.md"), "old content", "utf-8");

    const result = await exportToObsidian(item, config);

    expect(result.path).toBe("0_Inbox/Overwrite Me.md");
    const content = readFileSync(join(inboxDir, "Overwrite Me.md"), "utf-8");
    expect(content).toContain("# Overwrite Me");
    expect(content).not.toContain("old content");
  });

  it("returns correct relative path", async () => {
    const item = makeItem({ title: "Path Check" });
    const result = await exportToObsidian(item, config);
    expect(result.path).toBe("0_Inbox/Path Check.md");
  });

  it("throws when vaultPath is empty", async () => {
    config.vaultPath = "";
    const item = makeItem({ title: "No Vault" });
    await expect(exportToObsidian(item, config)).rejects.toThrow(
      "Obsidian vault path is not configured",
    );
  });

  // --- Idempotent export guard (FG-005) ---

  // PR 2 ENG-P2-2: vault_files reverse-lookup replaces the prior O(N) disk
  // scan. Tests now seed sqlite with the matching vault_files + items_vault
  // rows so the reverse-lookup path triggers.
  function seedReexport(opts: {
    id: string;
    path: string;
    existingContent: string;
  }): Database.Database {
    const { sqlite } = createTestDb();
    sqlite
      .prepare(
        "INSERT INTO vault_files (path, title, frontmatter, content, mtime, content_hash, sparkle_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(opts.path, "Old", null, opts.existingContent, 1, "h", opts.id);
    sqlite
      .prepare(
        "INSERT INTO items_vault (id, title, exported_at, created, content_snippet) VALUES (?, ?, ?, ?, ?)",
      )
      .run(opts.id, "Old", "2026-04-30T00:00:00Z", "2026-04-30T00:00:00Z", "");
    return sqlite;
  }

  it("new mode + sparkle_id match → returns skipped and does not modify existing file", async () => {
    config.exportMode = "new";
    const id = uuidv4();
    const item = makeItem({ id, title: "Original Title" });

    const inboxDir = join(tempDir, "0_Inbox");
    mkdirSync(inboxDir, { recursive: true });
    const existingContent = `---\nsparkle_id: "${id}"\n---\n\n# Old Title\n\nOld body\n`;
    writeFileSync(join(inboxDir, "Old Title.md"), existingContent, "utf-8");

    const sqlite = seedReexport({
      id,
      path: "0_Inbox/Old Title.md",
      existingContent,
    });

    const result = await exportToObsidian(item, config, sqlite);

    expect(result.skipped).toBe(true);
    expect(result.path).toBe("0_Inbox/Old Title.md");
    const content = readFileSync(join(inboxDir, "Old Title.md"), "utf-8");
    expect(content).toBe(existingContent);
  });

  it("overwrite mode + sparkle_id match → overwrites the existing file even if filename differs", async () => {
    config.exportMode = "overwrite";
    const id = uuidv4();
    const item = makeItem({ id, title: "New Title" });

    const inboxDir = join(tempDir, "0_Inbox");
    mkdirSync(inboxDir, { recursive: true });
    const existingContent = `---\nsparkle_id: "${id}"\n---\n\n# Old Name\n\nOld body\n`;
    writeFileSync(join(inboxDir, "Old Name.md"), existingContent, "utf-8");

    const sqlite = seedReexport({
      id,
      path: "0_Inbox/Old Name.md",
      existingContent,
    });

    const result = await exportToObsidian(item, config, sqlite);

    expect(result.skipped).toBeUndefined();
    expect(result.path).toBe("0_Inbox/Old Name.md");
    const content = readFileSync(join(inboxDir, "Old Name.md"), "utf-8");
    expect(content).toContain("# New Title");
    expect(content).toContain(`sparkle_id: "${id}"`);
    expect(content).not.toContain("Old body");
  });

  it("vault_files row points at sparkle_id but items_vault is missing → throws ExportCrashRecoveryError", async () => {
    config.exportMode = "overwrite";
    const id = uuidv4();
    const item = makeItem({ id, title: "Crashed Export" });

    const { sqlite } = createTestDb();
    sqlite
      .prepare(
        "INSERT INTO vault_files (path, title, frontmatter, content, mtime, content_hash, sparkle_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run("0_Inbox/Crashed.md", "Crashed", null, "x", 1, "h", id);
    // items_vault deliberately empty — simulates the crash window

    await expect(exportToObsidian(item, config, sqlite)).rejects.toThrow(
      /EXPORT_CRASH_RECOVERY|未完成/,
    );
  });

  it("different sparkle_id but same title → creates collision-suffixed file", async () => {
    config.exportMode = "new";
    const item = makeItem({ id: "different-sparkle-id", title: "Same Title" });

    // Pre-create a file with same title but different sparkle_id
    const inboxDir = join(tempDir, "0_Inbox");
    mkdirSync(inboxDir, { recursive: true });
    const existingContent =
      '---\nsparkle_id: "other-sparkle-id"\n---\n\n# Same Title\n\nExisting body\n';
    writeFileSync(join(inboxDir, "Same Title.md"), existingContent, "utf-8");

    const result = await exportToObsidian(item, config);

    // Should NOT be skipped (different sparkle_id)
    expect(result.skipped).toBeUndefined();
    // Should have collision suffix
    expect(result.path).not.toBe("0_Inbox/Same Title.md");
    expect(result.path).toMatch(/^0_Inbox\/Same Title \(\d{8}-\d{6}\)\.md$/);
  });
});

// ============================================================
// commitExportToVault — atomic move items_active → items_vault
// ============================================================
describe("commitExportToVault", () => {
  let sqlite: Database.Database;

  // Defaults: permanent note with a body. Override fields the specific test
  // cares about (content length, is_private, category_id, tags, etc.).
  function insertActive(
    overrides: {
      id?: string;
      title?: string;
      content?: string | null;
      category_id?: string | null;
      tags?: string[];
      aliases?: string[];
      source?: string | null;
      origin?: string;
      is_private?: 0 | 1;
      created?: string;
    } = {},
  ): string {
    return insertActiveRow(sqlite, {
      id: overrides.id,
      type: "note",
      status: "permanent",
      title: overrides.title ?? "Active note",
      content: "content" in overrides ? overrides.content! : "some body content",
      tags: overrides.tags,
      aliases: overrides.aliases,
      origin: overrides.origin,
      source: overrides.source,
      category_id: overrides.category_id,
      is_private: overrides.is_private,
      created: overrides.created,
      modified: overrides.created,
    });
  }

  /** Build the ItemForExport object commitExportToVault expects. */
  function makeExportItem(
    id: string,
    overrides: Partial<{
      title: string;
      category_id: string | null;
      tags: string;
      aliases: string;
      source: string | null;
      origin: string | null;
      created: string;
      is_private: number;
      content: string | null;
    }> = {},
  ) {
    return {
      id,
      title: overrides.title ?? "Active note",
      category_id: overrides.category_id ?? null,
      tags: overrides.tags ?? "[]",
      aliases: overrides.aliases ?? "[]",
      source: overrides.source ?? null,
      origin: overrides.origin ?? "",
      created: overrides.created ?? "2026-01-01T00:00:00.000Z",
      is_private: overrides.is_private ?? 0,
      // Use `in` to distinguish explicit null/undefined from absent property
      content: "content" in overrides ? overrides.content! : "some body content",
    };
  }

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
  });

  afterEach(() => {
    sqlite?.close();
  });

  it("happy path: moves active row to vault, preserves fields, stamps exported_at + content_snippet", () => {
    const id = insertActive({
      title: "Export me",
      content: "Line 1\nLine 2\nLine 3",
      tags: ["work", "note"],
      aliases: ["alt"],
      source: "https://example.com",
      origin: "web",
      is_private: 0,
      created: "2026-02-14T09:00:00.000Z",
    });

    const beforeExport = Date.now();
    commitExportToVault(
      sqlite,
      makeExportItem(id, {
        title: "Export me",
        tags: '["work","note"]',
        aliases: '["alt"]',
        source: "https://example.com",
        origin: "web",
        created: "2026-02-14T09:00:00.000Z",
        is_private: 0,
        content: "Line 1\nLine 2\nLine 3",
      }),
      "0_Inbox/Export me.md",
    );
    const afterExport = Date.now();

    // items_active row is gone
    const activeRow = sqlite.prepare("SELECT id FROM items_active WHERE id = ?").get(id) as
      | { id: string }
      | undefined;
    expect(activeRow).toBeUndefined();

    // items_vault row is present with all fields preserved
    const vaultRow = sqlite
      .prepare(
        `SELECT id, title, category_id, tags, aliases, source, origin,
                export_path, exported_at, created, is_private, content_snippet
         FROM items_vault WHERE id = ?`,
      )
      .get(id) as {
      id: string;
      title: string;
      category_id: string | null;
      tags: string;
      aliases: string;
      source: string | null;
      origin: string | null;
      export_path: string;
      exported_at: string;
      created: string;
      is_private: number;
      content_snippet: string;
    };

    expect(vaultRow).toBeDefined();
    expect(vaultRow.id).toBe(id);
    expect(vaultRow.title).toBe("Export me");
    expect(vaultRow.category_id).toBeNull();
    expect(vaultRow.tags).toBe('["work","note"]');
    expect(vaultRow.aliases).toBe('["alt"]');
    expect(vaultRow.source).toBe("https://example.com");
    expect(vaultRow.origin).toBe("web");
    expect(vaultRow.export_path).toBe("0_Inbox/Export me.md");
    expect(vaultRow.created).toBe("2026-02-14T09:00:00.000Z");
    expect(vaultRow.is_private).toBe(0);
    expect(vaultRow.content_snippet).toBe("Line 1\nLine 2\nLine 3");

    // exported_at is a valid ISO timestamp taken during the call
    expect(vaultRow.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const exportedMs = new Date(vaultRow.exported_at).getTime();
    expect(Number.isNaN(exportedMs)).toBe(false);
    expect(exportedMs).toBeGreaterThanOrEqual(beforeExport);
    expect(exportedMs).toBeLessThanOrEqual(afterExport);
  });

  it("preserves category_id foreign key to existing category", () => {
    const catId = uuidv4();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        "INSERT INTO categories (id, name, sort_order, created, modified) VALUES (?, ?, 0, ?, ?)",
      )
      .run(catId, "Work", now, now);

    const id = insertActive({ category_id: catId });

    commitExportToVault(sqlite, makeExportItem(id, { category_id: catId }), "0_Inbox/foo.md");

    const vaultRow = sqlite.prepare("SELECT category_id FROM items_vault WHERE id = ?").get(id) as {
      category_id: string | null;
    };
    expect(vaultRow.category_id).toBe(catId);
  });

  it("truncates content_snippet at 500 chars when content is long", () => {
    const id = insertActive();
    const longContent = "a".repeat(600);

    commitExportToVault(sqlite, makeExportItem(id, { content: longContent }), "0_Inbox/long.md");

    const vaultRow = sqlite
      .prepare("SELECT content_snippet FROM items_vault WHERE id = ?")
      .get(id) as { content_snippet: string };
    expect(vaultRow.content_snippet).toHaveLength(500);
    expect(vaultRow.content_snippet).toBe("a".repeat(500));
  });

  it("stores content_snippet as empty string when content is empty", () => {
    const id = insertActive();

    commitExportToVault(sqlite, makeExportItem(id, { content: "" }), "0_Inbox/empty.md");

    const vaultRow = sqlite
      .prepare("SELECT content_snippet FROM items_vault WHERE id = ?")
      .get(id) as { content_snippet: string };
    expect(vaultRow.content_snippet).toBe("");
  });

  it("stores content_snippet as empty string when content is null", () => {
    const id = insertActive();

    commitExportToVault(sqlite, makeExportItem(id, { content: null }), "0_Inbox/null.md");

    const vaultRow = sqlite
      .prepare("SELECT content_snippet FROM items_vault WHERE id = ?")
      .get(id) as { content_snippet: string };
    expect(vaultRow.content_snippet).toBe("");
  });

  it("passes content <= 500 chars through unchanged (no truncation)", () => {
    const id = insertActive();
    const body = "a".repeat(500);

    commitExportToVault(sqlite, makeExportItem(id, { content: body }), "0_Inbox/edge.md");

    const vaultRow = sqlite
      .prepare("SELECT content_snippet FROM items_vault WHERE id = ?")
      .get(id) as { content_snippet: string };
    expect(vaultRow.content_snippet).toBe(body);
    expect(vaultRow.content_snippet).toHaveLength(500);
  });

  it("transaction atomicity: throws and rolls back DELETE when INSERT conflicts on PK", () => {
    const id = insertActive({ title: "Original active" });

    // Pre-insert a vault row with the same id so the INSERT in commitExportToVault
    // fails with a PRIMARY KEY conflict. The DELETE that follows MUST NOT run.
    sqlite
      .prepare(
        `INSERT INTO items_vault
           (id, title, tags, aliases, origin, exported_at, created, is_private, content_snippet, export_path)
         VALUES (?, ?, '[]', '[]', '', ?, ?, 0, ?, ?)`,
      )
      .run(
        id,
        "Pre-existing vault row",
        "2025-12-01T00:00:00.000Z",
        "2025-12-01T00:00:00.000Z",
        "pre-existing snippet",
        "0_Inbox/pre-existing.md",
      );

    expect(() =>
      commitExportToVault(
        sqlite,
        makeExportItem(id, {
          title: "Original active",
          content: "new snippet attempt",
        }),
        "0_Inbox/should-not-apply.md",
      ),
    ).toThrow();

    // items_active row MUST still exist — the DELETE was inside the same tx
    // that threw on INSERT, so it rolled back.
    const activeRow = sqlite.prepare("SELECT id, title FROM items_active WHERE id = ?").get(id) as
      | { id: string; title: string }
      | undefined;
    expect(activeRow).toBeDefined();
    expect(activeRow!.title).toBe("Original active");

    // items_vault row is the pre-existing one — content_snippet and export_path
    // were NOT overwritten.
    const vaultRow = sqlite
      .prepare("SELECT title, content_snippet, export_path FROM items_vault WHERE id = ?")
      .get(id) as { title: string; content_snippet: string; export_path: string };
    expect(vaultRow.title).toBe("Pre-existing vault row");
    expect(vaultRow.content_snippet).toBe("pre-existing snippet");
    expect(vaultRow.export_path).toBe("0_Inbox/pre-existing.md");
  });

  it("sets is_private=1 when caller passes is_private=1", () => {
    const id = insertActive({ is_private: 1 });

    commitExportToVault(sqlite, makeExportItem(id, { is_private: 1 }), "0_Inbox/private.md");

    const vaultRow = sqlite.prepare("SELECT is_private FROM items_vault WHERE id = ?").get(id) as {
      is_private: number;
    };
    expect(vaultRow.is_private).toBe(1);
  });

  it("seeds vault_files inside the tx when diskBytes is provided", () => {
    const id = insertActive({ title: "Seed me" });
    commitExportToVault(
      sqlite,
      makeExportItem(id, { title: "Seed me", content: "body" }),
      "0_Inbox/Seed me.md",
      {
        content: '---\nsparkle_id: "' + id + '"\n---\n\n# Seed me\n\nbody\n',
        mtime: 1700000000000,
        contentHash: "abc123",
        frontmatter: 'sparkle_id: "' + id + '"',
      },
    );
    const vfRow = sqlite
      .prepare("SELECT path, sparkle_id, mtime, content_hash FROM vault_files WHERE sparkle_id = ?")
      .get(id) as
      | { path: string; sparkle_id: string; mtime: number; content_hash: string }
      | undefined;
    expect(vfRow).toBeDefined();
    expect(vfRow!.path).toBe("0_Inbox/Seed me.md");
    expect(vfRow!.mtime).toBe(1700000000000);
    expect(vfRow!.content_hash).toBe("abc123");
  });

  it("rolls back vault_files seed when items_vault INSERT fails (atomicity)", () => {
    const id = insertActive({ title: "Atomic" });
    // Force items_vault INSERT to fail by pre-inserting a row at the same id.
    sqlite
      .prepare(
        `INSERT INTO items_vault (id, title, tags, aliases, origin, exported_at, created, is_private, content_snippet, export_path)
         VALUES (?, 'pre', '[]', '[]', '', ?, ?, 0, '', '0_Inbox/pre.md')`,
      )
      .run(id, "2025-12-01T00:00:00Z", "2025-12-01T00:00:00Z");

    expect(() =>
      commitExportToVault(sqlite, makeExportItem(id, { title: "Atomic" }), "0_Inbox/Atomic.md", {
        content: "x",
        mtime: 1,
        contentHash: "h",
        frontmatter: null,
      }),
    ).toThrow();

    // No vault_files row at the new path — the INSERT (which would have happened
    // inside the same tx as the failed items_vault INSERT) was rolled back.
    const stray = sqlite
      .prepare("SELECT path FROM vault_files WHERE path = ?")
      .get("0_Inbox/Atomic.md");
    expect(stray).toBeUndefined();

    // items_active row is still present (DELETE rolled back).
    const active = sqlite.prepare("SELECT id FROM items_active WHERE id = ?").get(id);
    expect(active).toBeDefined();
  });

  it("ON CONFLICT(path) updates existing vault_files row (path collision absorbs cleanly)", () => {
    const id = insertActive({ title: "Collide" });
    // Pre-existing vault_files row at the path the export will use, perhaps from
    // a prior scanner pass that indexed it without sparkle_id.
    sqlite
      .prepare(
        `INSERT INTO vault_files (path, title, frontmatter, content, mtime, content_hash, sparkle_id)
         VALUES (?, 'Old', NULL, 'old', 1, 'oldhash', NULL)`,
      )
      .run("0_Inbox/Collide.md");

    commitExportToVault(
      sqlite,
      makeExportItem(id, { title: "Collide", content: "new body" }),
      "0_Inbox/Collide.md",
      {
        content: "new body",
        mtime: 2,
        contentHash: "newhash",
        frontmatter: 'sparkle_id: "' + id + '"',
      },
    );

    const row = sqlite
      .prepare("SELECT title, sparkle_id, content_hash, mtime FROM vault_files WHERE path = ?")
      .get("0_Inbox/Collide.md") as {
      title: string;
      sparkle_id: string | null;
      content_hash: string;
      mtime: number;
    };
    expect(row.sparkle_id).toBe(id);
    expect(row.content_hash).toBe("newhash");
    expect(row.mtime).toBe(2);
  });
});
