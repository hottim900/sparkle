// Shared wikilink parser used by:
//   - server/lib/wikilink.ts (reindex + backfill)
//   - server/lib/export.ts (legacy resolver bridge — ENG-26)
//   - WikilinkText renderer in src/components/wikilink-text.tsx
//
// Lives under src/lib so the frontend bundle can import it directly without
// a server roundtrip. The server imports it via a TS path alias.

/** A single `[[…]]` reference found inside an item's content. */
export interface ParsedWikilink {
  /** The title portion before `|`. Trimmed. */
  title: string;
  /** Optional alias portion after `|`. Trimmed. `null` when absent. */
  alias: string | null;
  /** JS string index (UTF-16 code unit) of the leading `[[`. */
  start: number;
  /** Length of the entire `[[…]]` span, including delimiters. */
  length: number;
  /** Verbatim source text including `[[` and `]]`. */
  raw: string;
}

/**
 * Maximum allowed title length inside `[[…]]`. Beyond this the parser
 * skips the candidate to avoid DoS on pathological input (ENG-18).
 */
export const MAX_WIKILINK_TITLE_LENGTH = 256;

interface ParseOptions {
  /**
   * When `true` (default), regions inside fenced (` ``` `) and inline
   * (\`single backtick\`) code are skipped — hex tokens or pseudo-wikilinks
   * inside code samples must not become live references (ENG-26).
   */
  skipCode?: boolean;
}

/**
 * Parse all `[[…]]` references out of an item's content.
 *
 * The parser is intentionally conservative:
 *  - rejects multi-line titles (`[[foo\nbar]]` is skipped — Obsidian
 *    also rejects them).
 *  - rejects empty titles after trim (`[[]]` and `[[  ]]` are skipped).
 *  - rejects titles longer than `MAX_WIKILINK_TITLE_LENGTH`.
 *  - rejects titles that themselves contain `[[` (would indicate the
 *    user actually wanted nested or escaped brackets — out of scope).
 *  - rejects alias halves containing `\n`.
 *
 * No resolver lookup. Callers map `title` to an item id themselves.
 */
export function parseWikilinks(content: string, opts: ParseOptions = {}): ParsedWikilink[] {
  const skipCode = opts.skipCode !== false;
  const codeRanges = skipCode ? findCodeRanges(content) : [];
  const results: ParsedWikilink[] = [];

  let i = 0;
  const n = content.length;
  while (i < n - 1) {
    if (content.charCodeAt(i) !== 91 || content.charCodeAt(i + 1) !== 91) {
      // not '[['
      i++;
      continue;
    }
    if (insideRange(codeRanges, i)) {
      i = jumpPastCode(codeRanges, i);
      continue;
    }
    const closeIdx = findClose(content, i + 2);
    if (closeIdx === -1) {
      // unbalanced; stop scanning — Obsidian also stops at first unbalanced.
      break;
    }
    const inner = content.slice(i + 2, closeIdx);
    const parsed = parseInner(inner);
    if (parsed) {
      results.push({
        title: parsed.title,
        alias: parsed.alias,
        start: i,
        length: closeIdx + 2 - i,
        raw: content.slice(i, closeIdx + 2),
      });
    }
    i = closeIdx + 2;
  }
  return results;
}

interface InnerParseResult {
  title: string;
  alias: string | null;
}

function parseInner(inner: string): InnerParseResult | null {
  if (inner.includes("\n")) return null;
  if (inner.includes("[[")) return null;
  const pipeIdx = inner.indexOf("|");
  let titleRaw: string;
  let aliasRaw: string | null;
  if (pipeIdx === -1) {
    titleRaw = inner;
    aliasRaw = null;
  } else {
    titleRaw = inner.slice(0, pipeIdx);
    aliasRaw = inner.slice(pipeIdx + 1);
  }
  const title = titleRaw.trim();
  if (title.length === 0) return null;
  if (title.length > MAX_WIKILINK_TITLE_LENGTH) return null;
  const alias = aliasRaw === null ? null : aliasRaw.trim();
  if (alias !== null && alias.length === 0) return null;
  return { title, alias };
}

function findClose(content: string, from: number): number {
  // Returns index of the leading `]` of `]]`, or -1 if none before EOF.
  // Stops at `\n` (multi-line titles are rejected anyway, and stopping
  // bounds parse cost on degenerate input).
  const n = content.length;
  for (let j = from; j < n - 1; j++) {
    const c = content.charCodeAt(j);
    if (c === 10) return -1; // newline before close
    if (c === 93 && content.charCodeAt(j + 1) === 93) return j;
  }
  return -1;
}

interface CodeRange {
  start: number;
  end: number;
}

/**
 * Find regions to skip: fenced code blocks (` ``` ` or `~~~`) and inline
 * backtick spans. Conservative — favours skipping over false positives,
 * since a missed wikilink inside code is less bad than a false positive
 * that creates a phantom reference.
 */
function findCodeRanges(content: string): CodeRange[] {
  const ranges: CodeRange[] = [];
  const n = content.length;
  let i = 0;
  while (i < n) {
    // Detect fenced block opener at line start (after \n or at content[0]).
    if (i === 0 || content[i - 1] === "\n") {
      const fence = matchFence(content, i);
      if (fence) {
        const close = findFenceClose(content, fence.endOfOpener, fence.marker, fence.length);
        ranges.push({ start: i, end: close });
        i = close;
        continue;
      }
    }
    // Detect inline backtick span.
    if (content[i] === "`") {
      const runLen = countRun(content, i, "`");
      const close = findBacktickClose(content, i + runLen, runLen);
      if (close !== -1) {
        ranges.push({ start: i, end: close + runLen });
        i = close + runLen;
        continue;
      }
    }
    i++;
  }
  return ranges;
}

interface FenceMatch {
  marker: "`" | "~";
  length: number;
  endOfOpener: number;
}

function matchFence(content: string, lineStart: number): FenceMatch | null {
  const c = content[lineStart];
  if (c !== "`" && c !== "~") return null;
  const runLen = countRun(content, lineStart, c);
  if (runLen < 3) return null;
  // Skip to end of line (info string).
  let j = lineStart + runLen;
  while (j < content.length && content[j] !== "\n") j++;
  return { marker: c, length: runLen, endOfOpener: j };
}

function findFenceClose(content: string, from: number, marker: "`" | "~", openLen: number): number {
  const n = content.length;
  let i = from;
  while (i < n) {
    if (content[i] !== "\n") {
      i++;
      continue;
    }
    const lineStart = i + 1;
    if (lineStart < n && content[lineStart] === marker) {
      const runLen = countRun(content, lineStart, marker);
      if (runLen >= openLen) {
        // Skip rest of closing line.
        let j = lineStart + runLen;
        while (j < n && content[j] !== "\n") j++;
        return j;
      }
    }
    i++;
  }
  return n; // unclosed fence — swallow rest of content
}

function findBacktickClose(content: string, from: number, runLen: number): number {
  const n = content.length;
  let i = from;
  while (i < n) {
    if (content[i] !== "`") {
      // backtick spans don't cross newlines per CommonMark
      if (content[i] === "\n") return -1;
      i++;
      continue;
    }
    const r = countRun(content, i, "`");
    if (r === runLen) return i;
    i += r;
  }
  return -1;
}

function countRun(content: string, from: number, char: string): number {
  let n = 0;
  while (from + n < content.length && content[from + n] === char) n++;
  return n;
}

function insideRange(ranges: CodeRange[], pos: number): boolean {
  for (const r of ranges) {
    if (pos >= r.start && pos < r.end) return true;
    if (r.start > pos) return false;
  }
  return false;
}

function jumpPastCode(ranges: CodeRange[], pos: number): number {
  for (const r of ranges) {
    if (pos >= r.start && pos < r.end) return r.end;
  }
  return pos + 1;
}

/**
 * Title normalization used by the uniqueness check (per
 * docs/wikilink-spec.md#pre-pr0e). Two titles collide when their
 * normalized forms are equal.
 *
 * - trim
 * - NFC
 * - ASCII case-insensitive (CJK case stays distinct)
 */
export function normalizeTitleForUniqueness(s: string): string {
  return s.trim().normalize("NFC").toLowerCase();
}

/**
 * Titles that bypass the uniqueness check. Quick-capture fallbacks
 * MUST be allowed to collide — blocking the literal "未命名" would
 * break the fleeting-capture flow (two `未命名` rows exist in prod
 * today as of 2026-05-18 audit).
 */
export const TITLE_UNIQUENESS_ALLOWLIST: ReadonlySet<string> = new Set([
  normalizeTitleForUniqueness("未命名"),
]);

export function isTitleInAllowlist(title: string): boolean {
  return TITLE_UNIQUENESS_ALLOWLIST.has(normalizeTitleForUniqueness(title));
}

/**
 * Strip `[[…]]` wrappers from text so the underlying title flows
 * through plain-text surfaces (LINE daily brief, share pages) without
 * leaking markdown.
 *
 * `[[Foo]]` → `Foo`
 * `[[Foo|bar]]` → `bar` (alias wins for display)
 * Unbalanced or malformed leftovers pass through verbatim.
 *
 * `skipCode` defaults to `false` — strip everything. Pass `true` when
 * the surface preserves code blocks verbatim (the share page renders
 * code via marked, and a user who wrote `[[example]]` inside a fenced
 * block expected the literal text to render).
 */
export function stripWikilinkMarkup(content: string, opts: { skipCode?: boolean } = {}): string {
  const refs = parseWikilinks(content, { skipCode: opts.skipCode === true });
  if (refs.length === 0) return content;
  // Replace in descending start order so earlier indices stay valid.
  let result = content;
  for (let i = refs.length - 1; i >= 0; i--) {
    const r = refs[i]!;
    const display = r.alias ?? r.title;
    result = result.slice(0, r.start) + display + result.slice(r.start + r.length);
  }
  return result;
}
