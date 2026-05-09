import { normalize } from "./normalize.js";
import { ambiguousMatch, noMatch, type EditFailure, type MatchLocation } from "./errors.js";

export type MatchTier = "exact" | "punctuation_normalized";

export type MatchResult =
  | { ok: true; range: [number, number]; tier: MatchTier }
  | { ok: false; failure: EditFailure };

export interface FindMatchArgs {
  content: string;
  needle: string;
  /** Half-open code-unit ranges to exclude from Tier-2 candidates. */
  codeRanges: ReadonlyArray<readonly [number, number]>;
  /** Index of the originating op in the user-provided ops array. */
  opIndex: number;
  /**
   * `lineStarts[i]` = UTF-16 offset of the start of line `i+1`. Used to map
   * match offsets back to 1-indexed line numbers for AMBIGUOUS_MATCH locations.
   */
  lineStarts: readonly number[];
}

const PREVIEW_LENGTH = 80;

/**
 * Tiered fuzzy match for `replace_text`.
 *
 * Tier 1: byte-exact `String.indexOf` walk. Code regions are NOT excluded —
 *   if the LLM provided an exact-byte string, we trust they meant it (including
 *   matches inside code blocks). Documented asymmetry vs. Tier 2.
 *
 * Tier 2 (only fires when Tier 1 returns zero matches): the same walk on the
 *   punctuation-folded text. Each candidate range maps back to the original
 *   offsets via the reversible indexMap and is then dropped if it intersects
 *   any code range — so an English code sample (`: ;`) interleaved with
 *   Chinese prose (`：；`) only matches in prose.
 */
export function findMatch(args: FindMatchArgs): MatchResult {
  const { content, needle, codeRanges, opIndex, lineStarts } = args;

  const tier1Matches = findAllOccurrences(content, needle);
  if (tier1Matches.length === 1) {
    const start = tier1Matches[0]!;
    return { ok: true, range: [start, start + needle.length], tier: "exact" };
  }
  if (tier1Matches.length > 1) {
    const locations = tier1Matches.map(start =>
      makeLocation(content, start, start + needle.length, lineStarts),
    );
    return {
      ok: false,
      failure: ambiguousMatch({ op_index: opIndex, match_tier: "exact", locations }),
    };
  }

  const { folded: normContent, indexMap } = normalize(content);
  const { folded: normNeedle } = normalize(needle);
  if (normNeedle.length === 0) {
    return failNoMatch(content, needle, opIndex, "exact");
  }

  const tier2Matches = findAllOccurrences(normContent, normNeedle);
  const ranges: Array<[number, number]> = [];
  for (const i of tier2Matches) {
    const start = indexMap[i]!;
    const end = indexMap[i + normNeedle.length]!;
    if (!intersectsAny([start, end], codeRanges)) {
      ranges.push([start, end]);
    }
  }

  if (ranges.length === 1) {
    return { ok: true, range: ranges[0]!, tier: "punctuation_normalized" };
  }
  if (ranges.length > 1) {
    const locations = ranges.map(([s, e]) => makeLocation(content, s, e, lineStarts));
    return {
      ok: false,
      failure: ambiguousMatch({
        op_index: opIndex,
        match_tier: "punctuation_normalized",
        locations,
      }),
    };
  }

  return failNoMatch(content, needle, opIndex, "punctuation_normalized");
}

function findAllOccurrences(haystack: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const result: number[] = [];
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return result;
    result.push(idx);
    from = idx + 1;
  }
}

function intersectsAny(
  range: readonly [number, number],
  others: ReadonlyArray<readonly [number, number]>,
): boolean {
  const [aStart, aEnd] = range;
  if (aStart >= aEnd) return false;
  for (const [bStart, bEnd] of others) {
    if (bStart >= bEnd) continue;
    if (aStart < bEnd && bStart < aEnd) return true;
  }
  return false;
}

function makeLocation(
  content: string,
  start: number,
  end: number,
  lineStarts: readonly number[],
): MatchLocation {
  const startLine = offsetToLine(start, lineStarts);
  const endLine = offsetToLine(Math.max(start, end - 1), lineStarts);
  return {
    start_line: startLine,
    end_line: endLine,
    preview: content.slice(start, Math.min(end, start + PREVIEW_LENGTH)),
  };
}

function offsetToLine(offset: number, lineStarts: readonly number[]): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (lineStarts[mid]! <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(1, lo);
}

function failNoMatch(
  content: string,
  needle: string,
  opIndex: number,
  tier: MatchTier,
): MatchResult {
  const closest = closestSubstring(content, needle);
  const diff = closest === null ? null : charDiff(closest, needle);
  return {
    ok: false,
    failure: noMatch({
      op_index: opIndex,
      old_preview: needle.slice(0, PREVIEW_LENGTH),
      closest_match: closest,
      diff,
      match_tier: tier,
    }),
  };
}

/**
 * Best-effort similar substring using a shrinking-prefix anchor. Each
 * shrink step is one V8 indexOf (Boyer-Moore-Horspool internally), and the
 * loop is bounded to ≤13 iterations, so total cost is O(n) with a small
 * constant. Returns null when no prefix of length ≥ 4 hits.
 */
function closestSubstring(content: string, needle: string): string | null {
  if (content.length === 0 || needle.length === 0) return null;
  const startLen = Math.min(needle.length, 16);
  for (let prefixLen = startLen; prefixLen >= 4; prefixLen--) {
    const idx = content.indexOf(needle.slice(0, prefixLen));
    if (idx === -1) continue;
    const end = Math.min(content.length, idx + needle.length + 20);
    return content.slice(idx, end).slice(0, 200);
  }
  return null;
}

function charDiff(a: string, b: string): string {
  const diffs: string[] = [];
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) continue;
    diffs.push(`@${i}: "${a[i]}"→"${b[i]}"`);
    if (diffs.length >= 8) break;
  }
  if (a.length !== b.length) {
    diffs.push(`length: ${a.length} vs ${b.length}`);
  }
  return diffs.join(", ");
}
