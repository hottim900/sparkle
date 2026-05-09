import { describe, it, expect } from "vitest";
import { normalize, PUNCTUATION_FOLDS } from "../../edit/normalize.js";

describe("normalize", () => {
  it("returns empty result for empty input", () => {
    const r = normalize("");
    expect(r.folded).toBe("");
    expect(r.indexMap).toEqual([0]); // sentinel only
  });

  it("preserves ASCII unchanged", () => {
    const r = normalize("hello world");
    expect(r.folded).toBe("hello world");
    expect(r.indexMap).toHaveLength("hello world".length + 1);
    expect(r.indexMap[0]).toBe(0);
    expect(r.indexMap.at(-1)).toBe("hello world".length);
  });

  it("folds all 9 CJK punctuation pairs to ASCII", () => {
    const cjk = "：；（），。！？、";
    const expected = ":;(),.!?,";
    const r = normalize(cjk);
    expect(r.folded).toBe(expected);
  });

  it("preserves non-fold CJK characters", () => {
    const r = normalize("我是中文");
    expect(r.folded).toBe("我是中文");
  });

  it("leaves Chinese quotation marks (「」『』) alone — not in fold list", () => {
    const r = normalize("「你好」");
    expect(r.folded).toBe("「你好」");
  });

  it("mixed CJK + ASCII: folded only at fold pairs", () => {
    const input = "我說：『你好』，他笑了。";
    const r = normalize(input);
    expect(r.folded).toBe("我說:『你好』,他笑了.");
  });

  it("invariant: input.length === folded.length (UTF-16 code units)", () => {
    const cases = [
      "",
      "a",
      "hello",
      "：；",
      "我說：『你好』。",
      "🔥abc",
      "𝕏𝕐𝕑emoji",
      "abc：def；ghi（）",
    ];
    for (const input of cases) {
      const r = normalize(input);
      expect(r.folded.length, `mismatch for ${JSON.stringify(input)}`).toBe(input.length);
    }
  });

  it("invariant: codepoint count matches between input and folded", () => {
    const cases = [
      "",
      "abc",
      "我說：你好。",
      "🔥hello",
      "𝕏𝕐",
    ];
    for (const input of cases) {
      const r = normalize(input);
      const inputCP = [...input].length;
      const foldedCP = [...r.folded].length;
      expect(foldedCP, `codepoint mismatch for ${JSON.stringify(input)}`).toBe(inputCP);
    }
  });

  it("indexMap has length folded.length + 1 with trailing sentinel = input.length", () => {
    const cases = ["", "abc", "：；", "我說：你好。", "🔥abc"];
    for (const input of cases) {
      const r = normalize(input);
      expect(r.indexMap).toHaveLength(r.folded.length + 1);
      expect(r.indexMap[r.folded.length]).toBe(input.length);
    }
  });

  it("indexMap is identity for 1:1 length-preserving folds", () => {
    const r = normalize("我說：你好。");
    for (let i = 0; i <= r.folded.length; i++) {
      expect(r.indexMap[i]).toBe(i);
    }
  });

  it("surrogate pair (emoji) — Tier-2 match starting after emoji has correct offsets", () => {
    const input = "🔥我說：你好。";
    const r = normalize(input);
    // 🔥 is 2 UTF-16 code units; "我說：你好。" follows at offset 2.
    // Folded: "🔥我說:你好.".
    const matchInFolded = r.folded.indexOf("我說:");
    expect(matchInFolded).toBe(2); // after 🔥
    // Map back to original
    const originalStart = r.indexMap[matchInFolded]!;
    const originalEnd = r.indexMap[matchInFolded + 3]!;
    expect(input.slice(originalStart, originalEnd)).toBe("我說：");
  });

  it("EOF Tier-2 match resolves via sentinel without out-of-bounds", () => {
    const input = "尾巴。";
    const r = normalize(input);
    expect(r.folded).toBe("尾巴.");
    // Match the very last char in folded
    const matchAt = r.folded.indexOf(".");
    expect(matchAt).toBe(2);
    // End offset uses the sentinel at index folded.length
    const start = r.indexMap[matchAt]!;
    const end = r.indexMap[matchAt + 1]!; // sentinel
    expect(input.slice(start, end)).toBe("。");
    expect(end).toBe(input.length);
  });

  it("PUNCTUATION_FOLDS exposes the 9 curated pairs", () => {
    expect(PUNCTUATION_FOLDS).toHaveLength(9);
    const map = new Map(PUNCTUATION_FOLDS);
    expect(map.get("：")).toBe(":");
    expect(map.get("；")).toBe(";");
    expect(map.get("（")).toBe("(");
    expect(map.get("）")).toBe(")");
    expect(map.get("，")).toBe(",");
    expect(map.get("。")).toBe(".");
    expect(map.get("！")).toBe("!");
    expect(map.get("？")).toBe("?");
    expect(map.get("、")).toBe(",");
  });
});
