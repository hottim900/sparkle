import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  sanitizeFilename,
  generateFrontmatter,
  generateMarkdown,
  exportToObsidian,
  ExportableItem,
  ExportConfig,
} from "../export.js";

// ============================================================
// sanitizeFilename
// ============================================================
describe("sanitizeFilename", () => {
  it("replaces forbidden chars with dash", () => {
    expect(sanitizeFilename('a/b\\c:d*e?"f<g>h|i[j]k#l^m')).toBe(
      "a-b-c-d-e-f-g-h-i-j-k-l-m",
    );
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
    const fm = generateFrontmatter(
      makeItem({ tags: '["work","urgent"]' }),
    );
    expect(fm).toContain("tags:");
    expect(fm).toContain("  - work");
    expect(fm).toContain("  - urgent");
  });

  it("omits empty aliases", () => {
    const fm = generateFrontmatter(makeItem({ aliases: "[]" }));
    expect(fm).not.toContain("aliases:");
  });

  it("includes non-empty aliases", () => {
    const fm = generateFrontmatter(
      makeItem({ aliases: '["Alias One","Alias Two"]' }),
    );
    expect(fm).toContain("aliases:");
    expect(fm).toContain('  - "Alias One"');
    expect(fm).toContain('  - "Alias Two"');
  });

  it("omits null source", () => {
    const fm = generateFrontmatter(makeItem({ source: null }));
    expect(fm).not.toContain("source:");
  });

  it("includes non-null source", () => {
    const fm = generateFrontmatter(
      makeItem({ source: "https://example.com" }),
    );
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

  it("uses local time without Z suffix", () => {
    const fm = generateFrontmatter(makeItem());
    // Should not have Z suffix in created/modified
    const lines = fm.split("\n");
    const createdLine = lines.find((l) => l.startsWith("created:"));
    const modifiedLine = lines.find((l) => l.startsWith("modified:"));
    expect(createdLine).toBeDefined();
    expect(modifiedLine).toBeDefined();
    expect(createdLine).not.toContain("Z");
    expect(modifiedLine).not.toContain("Z");
  });
});

// ============================================================
// generateMarkdown
// ============================================================
describe("generateMarkdown", () => {
  it("has correct format: frontmatter + blank line + H1 + blank line + body", () => {
    const item = makeItem({ title: "My Note", content: "Hello world" });
    const md = generateMarkdown(item);

    // Should start with frontmatter
    expect(md).toMatch(/^---\n/);
    // After frontmatter closing ---, should have blank line, then # Title, blank line, body
    const parts = md.split("---");
    // parts[0] is empty (before first ---), parts[1] is frontmatter content, parts[2] is rest
    const afterFrontmatter = parts[2];
    expect(afterFrontmatter).toBe("\n\n# My Note\n\nHello world\n");
  });

  it("handles empty content", () => {
    const item = makeItem({ title: "Empty", content: "" });
    const md = generateMarkdown(item);
    expect(md).toContain("# Empty\n\n\n");
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

  it("writes file to vault inbox folder", () => {
    const item = makeItem({ title: "Test Export" });
    const result = exportToObsidian(item, config);

    expect(result.path).toBe("0_Inbox/Test Export.md");
    const filePath = join(tempDir, "0_Inbox", "Test Export.md");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("# Test Export");
    expect(content).toContain('sparkle_id: "test-id-123"');
  });

  it("creates directory if it does not exist", () => {
    config.inboxFolder = "nested/deep/folder";
    const item = makeItem({ title: "Nested" });
    const result = exportToObsidian(item, config);

    expect(result.path).toBe("nested/deep/folder/Nested.md");
    const content = readFileSync(
      join(tempDir, "nested/deep/folder", "Nested.md"),
      "utf-8",
    );
    expect(content).toContain("# Nested");
  });

  it("handles collision in new mode by appending timestamp", () => {
    config.exportMode = "new";
    const item = makeItem({ title: "Collision" });

    // Create the file first so there's a collision
    const inboxDir = join(tempDir, "0_Inbox");
    mkdirSync(inboxDir, { recursive: true });
    writeFileSync(join(inboxDir, "Collision.md"), "existing", "utf-8");

    const result = exportToObsidian(item, config);

    // Should have a timestamp suffix instead of the original filename
    expect(result.path).not.toBe("0_Inbox/Collision.md");
    expect(result.path).toMatch(/^0_Inbox\/Collision \(\d{8}-\d{4}\)\.md$/);
  });

  it("overwrites existing file in overwrite mode", () => {
    config.exportMode = "overwrite";
    const item = makeItem({ title: "Overwrite Me" });

    // Create the file first
    const inboxDir = join(tempDir, "0_Inbox");
    mkdirSync(inboxDir, { recursive: true });
    writeFileSync(join(inboxDir, "Overwrite Me.md"), "old content", "utf-8");

    const result = exportToObsidian(item, config);

    expect(result.path).toBe("0_Inbox/Overwrite Me.md");
    const content = readFileSync(
      join(inboxDir, "Overwrite Me.md"),
      "utf-8",
    );
    expect(content).toContain("# Overwrite Me");
    expect(content).not.toContain("old content");
  });

  it("returns correct relative path", () => {
    const item = makeItem({ title: "Path Check" });
    const result = exportToObsidian(item, config);
    expect(result.path).toBe("0_Inbox/Path Check.md");
  });

  it("throws when vaultPath is empty", () => {
    config.vaultPath = "";
    const item = makeItem({ title: "No Vault" });
    expect(() => exportToObsidian(item, config)).toThrow(
      "Obsidian vault path is not configured",
    );
  });
});
