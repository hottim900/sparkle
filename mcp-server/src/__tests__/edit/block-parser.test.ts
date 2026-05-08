import { describe, it, expect } from "vitest";
import { parseBlocks } from "../../edit/block-parser.js";

function ok<T extends ReturnType<typeof parseBlocks>>(r: T) {
  if (!r.ok) throw new Error(`expected success, got failure: ${JSON.stringify(r.failure)}`);
  return r;
}

describe("parseBlocks", () => {
  it("returns no blocks for empty content", () => {
    const r = ok(parseBlocks(""));
    expect(r.blocks).toEqual([]);
    expect(r.codeRanges).toEqual([]);
  });

  it("emits one paragraph block for a single line", () => {
    const r = ok(parseBlocks("Hello world."));
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]!.type).toBe("paragraph");
    expect(r.blocks[0]!.handle).toBe("b0");
    expect(r.blocks[0]!.range).toEqual([1, 1]);
    expect(r.blocks[0]!.preview).toBe("Hello world.");
  });

  it("emits multiple paragraphs separated by blank lines", () => {
    const content = "Para one.\n\nPara two.\n\nPara three.";
    const r = ok(parseBlocks(content));
    expect(r.blocks).toHaveLength(3);
    expect(r.blocks.map(b => b.handle)).toEqual(["b0", "b1", "b2"]);
    expect(r.blocks.map(b => b.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
  });

  it("recognizes ATX headings", () => {
    const r = ok(parseBlocks("# Title\n\nBody"));
    expect(r.blocks[0]!.type).toBe("heading");
    expect(r.blocks[1]!.type).toBe("paragraph");
  });

  it("recognizes setext headings", () => {
    const content = "Title\n=====\n\nBody";
    const r = ok(parseBlocks(content));
    expect(r.blocks[0]!.type).toBe("heading");
  });

  it("recognizes fenced code blocks and adds them to codeRanges", () => {
    const content = "Intro.\n\n```js\nconsole.log(1);\n```\n\nOutro.";
    const r = ok(parseBlocks(content));
    expect(r.blocks.map(b => b.type)).toEqual(["paragraph", "code_block", "paragraph"]);
    const codeBlock = r.blocks[1]!;
    const found = r.codeRanges.some(
      ([s, e]) => s === codeBlock.offset_range[0] && e === codeBlock.offset_range[1],
    );
    expect(found).toBe(true);
  });

  it("collects inline code spans into codeRanges (not as their own block)", () => {
    const content = "Use `const x = 1` in code.";
    const r = ok(parseBlocks(content));
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]!.type).toBe("paragraph");
    expect(r.codeRanges).toHaveLength(1);
    const [s, e] = r.codeRanges[0]!;
    expect(content.slice(s, e)).toBe("`const x = 1`");
  });

  it("collects inline code nested inside list items", () => {
    const content = "- Item with `code`\n- Plain item";
    const r = ok(parseBlocks(content));
    expect(r.blocks[0]!.type).toBe("list");
    expect(r.codeRanges).toHaveLength(1);
    const [s, e] = r.codeRanges[0]!;
    expect(content.slice(s, e)).toBe("`code`");
  });

  it("recognizes ordered and unordered lists as one block each", () => {
    const content = "- a\n- b\n\n1. one\n2. two";
    const r = ok(parseBlocks(content));
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0]!.type).toBe("list");
    expect(r.blocks[1]!.type).toBe("list");
  });

  it("recognizes GFM tables as table blocks", () => {
    const content = "Para.\n\n| h1 | h2 |\n|----|----|\n| a  | b  |\n\nAfter.";
    const r = ok(parseBlocks(content));
    expect(r.blocks.map(b => b.type)).toEqual(["paragraph", "table", "paragraph"]);
  });

  it("recognizes blockquote", () => {
    const r = ok(parseBlocks("> quoted\n> still quoted"));
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0]!.type).toBe("blockquote");
  });

  it("recognizes thematic break (---)", () => {
    const content = "Above\n\n---\n\nBelow";
    const r = ok(parseBlocks(content));
    expect(r.blocks.map(b => b.type)).toEqual(["paragraph", "thematic_break", "paragraph"]);
  });

  it("preview field truncates to 80 characters", () => {
    const long = "a".repeat(200);
    const r = ok(parseBlocks(long));
    expect(r.blocks[0]!.preview).toHaveLength(80);
    expect(r.blocks[0]!.preview).toBe("a".repeat(80));
  });

  it("offset_range is half-open and matches content slice", () => {
    const content = "First paragraph.\n\nSecond paragraph.";
    const r = ok(parseBlocks(content));
    const [s0, e0] = r.blocks[0]!.offset_range;
    const [s1, e1] = r.blocks[1]!.offset_range;
    expect(content.slice(s0, e0)).toBe("First paragraph.");
    expect(content.slice(s1, e1)).toBe("Second paragraph.");
  });

  it("range is 1-indexed inclusive line numbers", () => {
    const content = "Para A.\n\nPara B.";
    const r = ok(parseBlocks(content));
    expect(r.blocks[0]!.range).toEqual([1, 1]);
    expect(r.blocks[1]!.range).toEqual([3, 3]);
  });

  it("real-world Chinese content with mixed blocks", () => {
    const content = `# 我的筆記

這是第一段文字，包含中文標點：你好。

\`\`\`python
print("hello")
\`\`\`

- 列表項目一
- 列表項目二

> 引用文字`;
    const r = ok(parseBlocks(content));
    const types = r.blocks.map(b => b.type);
    expect(types).toEqual(["heading", "paragraph", "code_block", "list", "blockquote"]);
  });

  it("handles malformed markdown without throwing (mdast is lenient)", () => {
    // mdast-util-from-markdown is very lenient; truly invalid markdown is rare.
    // Verify lenient parse on a truncated fence — treats remainder as code block.
    const content = "Para.\n\n```js\nconsole.log(1);\n";
    const r = parseBlocks(content);
    expect(r.ok).toBe(true);
  });
});
