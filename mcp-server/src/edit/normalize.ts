/**
 * Punctuation-only normalization with a reversible index map.
 *
 * Folds a curated list of CJK ↔ ASCII punctuation pairs so that LLM-supplied
 * `replace_text.old` strings still match when the model regenerated full-width
 * punctuation as half-width (or vice versa).
 *
 * Invariants enforced by this module:
 *   1. Every fold pair is exactly 1 UTF-16 code unit ↔ 1 UTF-16 code unit.
 *   2. `folded.length === input.length` (UTF-16 code units), so `indexMap[i]`
 *      is also a UTF-16 offset into the original string.
 *   3. `indexMap.length === folded.length + 1` — the trailing sentinel
 *      `indexMap[folded.length] = input.length` lets a Tier-2 match ending at
 *      EOF resolve to a valid splice range without an out-of-bounds read.
 */

const FOLD_MAP: Readonly<Record<string, string>> = Object.freeze({
  "：": ":", // ：
  "；": ";", // ；
  "（": "(", // （
  "）": ")", // ）
  "，": ",", // ，
  "。": ".", // 。
  "！": "!", // ！
  "？": "?", // ？
  "、": ",", // 、
});

export interface NormalizeResult {
  /** Folded string, same length in UTF-16 code units as the input. */
  folded: string;
  /**
   * `indexMap[i]` = UTF-16 offset of code unit `i` in the original input.
   *
   * Length is `folded.length + 1`; the trailing sentinel equals `input.length`
   * so callers can compute a Tier-2 match range as
   * `[indexMap[start], indexMap[end]]` with `end === folded.length` valid.
   */
  indexMap: number[];
}

export function normalize(input: string): NormalizeResult {
  const out: string[] = [];
  const indexMap: number[] = new Array(input.length + 1);
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    out.push(FOLD_MAP[ch] ?? ch);
    indexMap[i] = i;
  }
  indexMap[input.length] = input.length;
  return { folded: out.join(""), indexMap };
}

/** Exposed for tests — never mutate. */
export const PUNCTUATION_FOLDS: ReadonlyArray<readonly [string, string]> = Object.freeze(
  Object.entries(FOLD_MAP).map(([k, v]) => Object.freeze([k, v] as const)),
);
