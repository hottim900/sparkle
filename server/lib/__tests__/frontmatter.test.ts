import { describe, it, expect } from "vitest";
import { extractSparkleId } from "../frontmatter.js";

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
