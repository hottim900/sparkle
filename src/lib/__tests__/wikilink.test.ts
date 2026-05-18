import { describe, it, expect } from "vitest";
import {
  parseWikilinks,
  normalizeTitleForUniqueness,
  isTitleInAllowlist,
  stripWikilinkMarkup,
  MAX_WIKILINK_TITLE_LENGTH,
} from "../wikilink";

describe("parseWikilinks", () => {
  it("returns empty for content with no refs", () => {
    expect(parseWikilinks("hello world")).toEqual([]);
  });

  it("parses a single `[[Title]]`", () => {
    const r = parseWikilinks("see [[Foo]] please");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: "Foo", alias: null, raw: "[[Foo]]" });
    expect(r[0]!.start).toBe(4);
    expect(r[0]!.length).toBe(7);
  });

  it("parses `[[Title|alias]]`", () => {
    const r = parseWikilinks("[[Foo|bar]]");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: "Foo", alias: "bar" });
  });

  it("trims whitespace inside the brackets", () => {
    const r = parseWikilinks("[[  Foo  |  bar  ]]");
    expect(r[0]).toMatchObject({ title: "Foo", alias: "bar" });
  });

  it("rejects empty title", () => {
    expect(parseWikilinks("[[]]")).toEqual([]);
    expect(parseWikilinks("[[   ]]")).toEqual([]);
  });

  it("rejects multi-line wikilinks", () => {
    expect(parseWikilinks("[[Foo\nBar]]")).toEqual([]);
  });

  it("rejects empty alias after pipe", () => {
    expect(parseWikilinks("[[Foo|]]")).toEqual([]);
  });

  it(`rejects titles longer than ${MAX_WIKILINK_TITLE_LENGTH} chars (DoS guard)`, () => {
    const oversized = "a".repeat(MAX_WIKILINK_TITLE_LENGTH + 1);
    expect(parseWikilinks(`[[${oversized}]]`)).toEqual([]);
  });

  it("parses multiple refs in one string", () => {
    const r = parseWikilinks("[[A]] then [[B|alias]] and [[C]]");
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.title)).toEqual(["A", "B", "C"]);
  });

  it("skips refs inside fenced code blocks", () => {
    const content = "before\n```\n[[NotALink]]\n```\nafter [[Real]]";
    const r = parseWikilinks(content);
    expect(r).toHaveLength(1);
    expect(r[0]!.title).toBe("Real");
  });

  it("skips refs inside ~~~ fenced blocks", () => {
    const content = "~~~js\n[[NotALink]]\n~~~\n[[Real]]";
    const r = parseWikilinks(content);
    expect(r.map((x) => x.title)).toEqual(["Real"]);
  });

  it("skips refs inside inline backticks", () => {
    const content = "this `[[skipped]]` but [[kept]]";
    const r = parseWikilinks(content);
    expect(r.map((x) => x.title)).toEqual(["kept"]);
  });

  it("preserves UTF-16 char offsets for CJK content", () => {
    const r = parseWikilinks("中文 [[標題]] 結束");
    expect(r).toHaveLength(1);
    expect(r[0]!.start).toBe(3);
    expect(r[0]!.title).toBe("標題");
  });

  it("stops at first unbalanced bracket", () => {
    const r = parseWikilinks("[[NoClose");
    expect(r).toEqual([]);
  });

  it("rejects titles containing `[[`", () => {
    expect(parseWikilinks("[[Foo[[Bar]]")).toEqual([]);
  });
});

describe("normalizeTitleForUniqueness", () => {
  it("trims whitespace", () => {
    expect(normalizeTitleForUniqueness("  Foo  ")).toBe("foo");
  });

  it("applies NFC normalization", () => {
    // "é" decomposed (U+0065 U+0301) → composed (U+00E9)
    const decomposed = "Café";
    const composed = "Café";
    expect(normalizeTitleForUniqueness(decomposed)).toBe(normalizeTitleForUniqueness(composed));
  });

  it("ASCII case-insensitive", () => {
    expect(normalizeTitleForUniqueness("FOO")).toBe(normalizeTitleForUniqueness("foo"));
  });

  it("CJK case stays distinct from full-width", () => {
    // Half-width "ABC" should not collide with full-width "ＡＢＣ"
    expect(normalizeTitleForUniqueness("半形ABC")).not.toBe(
      normalizeTitleForUniqueness("全形ＡＢＣ"),
    );
  });
});

describe("isTitleInAllowlist", () => {
  it("allows literal `未命名`", () => {
    expect(isTitleInAllowlist("未命名")).toBe(true);
  });

  it("allows `  未命名  ` (trimmed)", () => {
    expect(isTitleInAllowlist("  未命名  ")).toBe(true);
  });

  it("rejects unrelated titles", () => {
    expect(isTitleInAllowlist("Foo")).toBe(false);
    expect(isTitleInAllowlist("無標題")).toBe(false);
  });
});

describe("stripWikilinkMarkup", () => {
  it("preserves text with no refs", () => {
    expect(stripWikilinkMarkup("hello")).toBe("hello");
  });

  it("strips `[[Foo]]` to `Foo`", () => {
    expect(stripWikilinkMarkup("see [[Foo]] now")).toBe("see Foo now");
  });

  it("strips alias `[[Foo|bar]]` to `bar`", () => {
    expect(stripWikilinkMarkup("see [[Foo|bar]] now")).toBe("see bar now");
  });

  it("strips multiple refs in correct order", () => {
    expect(stripWikilinkMarkup("[[A]] and [[B|b-alias]]")).toBe("A and b-alias");
  });
});
