import { describe, it, expect } from "vitest";
import { preprocessObsidian } from "../vault-markdown-preview";

describe("preprocessObsidian", () => {
  it("strips YAML frontmatter", () => {
    const input = "---\ntitle: Test\ntags: []\n---\nBody content";
    expect(preprocessObsidian(input)).toBe("Body content");
  });

  it("converts wikilinks [[target]] to bold text", () => {
    expect(preprocessObsidian("See [[My Note]] for details")).toBe("See **My Note** for details");
  });

  it("converts aliased wikilinks [[target|alias]] to bold alias", () => {
    expect(preprocessObsidian("Read [[long-note-name|this note]]")).toBe("Read **this note**");
  });

  it("converts embeds ![[filename]] to placeholder", () => {
    expect(preprocessObsidian("Content ![[diagram.png]] here")).toBe(
      "Content [內嵌：diagram.png] here",
    );
  });

  it("strips Obsidian comments %%...%%", () => {
    expect(preprocessObsidian("Before %%hidden%% after")).toBe("Before  after");
  });

  it("strips multi-line Obsidian comments", () => {
    const input = "Before %%\nthis is hidden\nacross lines\n%% after";
    expect(preprocessObsidian(input)).toBe("Before  after");
  });

  it("handles multiple wikilinks in same line", () => {
    expect(preprocessObsidian("See [[A]] and [[B]]")).toBe("See **A** and **B**");
  });

  it("passes through standard markdown unchanged", () => {
    const input = "# Heading\n\nParagraph with **bold** and *italic*.";
    expect(preprocessObsidian(input)).toBe(input);
  });

  it("handles content without frontmatter", () => {
    const input = "Just plain content";
    expect(preprocessObsidian(input)).toBe("Just plain content");
  });

  it("handles unclosed frontmatter gracefully", () => {
    const input = "---\nunclosed frontmatter\nContent here";
    expect(preprocessObsidian(input)).toBe(input);
  });
});
