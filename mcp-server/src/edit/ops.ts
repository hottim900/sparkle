import { parseBlocks, type Block } from "./block-parser.js";
import { computeRevision } from "./revision.js";
import { findMatch, type MatchTier } from "./fuzzy.js";
import * as errors from "./errors.js";
import type { EditFailure } from "./errors.js";

export type EditOp =
  | { kind: "replace_block"; handle: string; content: string }
  | { kind: "replace_lines"; start_line: number; end_line: number; content: string }
  | { kind: "replace_text"; old: string; new: string }
  | { kind: "delete_block"; handle: string }
  | { kind: "delete_lines"; start_line: number; end_line: number }
  | { kind: "insert_after_line"; line: number; content: string };

export const MAX_OPS = 50;
export const MAX_CONTENT_LENGTH = 50000;

export interface ApplyEditsArgs {
  content: string;
  expectedRevision: string;
  ops: readonly EditOp[];
}

export interface ApplySuccess {
  ok: true;
  newContent: string;
  newRevision: string;
  /** Fresh blocks for chaining the next sparkle_edit_note without a re-fetch. */
  newBlocks: Block[];
  newLines: Array<{ line: number; text: string }>;
  /** Per-op match tier (only populated for replace_text ops). */
  matchTiers: Array<MatchTier | undefined>;
}

export type ApplyResult = ApplySuccess | { ok: false; failure: EditFailure };

interface ResolvedOp {
  index: number;
  op: EditOp;
  /** Half-open code-unit range to splice. */
  range: [number, number];
  replacement: string;
  matchTier?: MatchTier;
}

/** Snapshot of the current content the resolver works against. */
interface ResolveContext {
  content: string;
  blocks: readonly Block[];
  codeRanges: readonly (readonly [number, number])[];
  lineStarts: readonly number[];
  totalLines: number;
}

/**
 * Apply a batch of edit ops atomically against `content` (pinned by
 * `expectedRevision`). All ops are resolved against the original snapshot —
 * never against intermediate state — so the caller can reason about effects
 * pre-batch.
 *
 * The caller is responsible for VAULT_READONLY: vault-origin items must be
 * filtered before reaching applyEdits (mcp-server's `vaultReadonlyResponse`
 * builds the canonical payload). Per design.md "Atomic multi-op application"
 * steps 2-8.
 */
export function applyEdits(args: ApplyEditsArgs): ApplyResult {
  const { content, expectedRevision, ops } = args;

  if (ops.length === 0) return { ok: false, failure: errors.emptyOps() };
  if (ops.length > MAX_OPS) {
    return { ok: false, failure: errors.tooManyOps({ ops_count: ops.length, max: MAX_OPS }) };
  }

  const currentRevision = computeRevision(content);
  const needsCodeRanges = ops.some(o => o.kind === "replace_text");
  const parsed = parseBlocks(content, { collectCodeRanges: needsCodeRanges });

  // Revision mismatch always wins over PARSE_ERROR — the LLM's right move
  // is "re-fetch and retry," not "fix the unparseable note." Surface the
  // mismatch with empty blocks if the (stale) content can't be parsed.
  if (currentRevision !== expectedRevision) {
    return {
      ok: false,
      failure: errors.revisionMismatch({
        revision: currentRevision,
        lines: makeLines(content),
        blocks: parsed.ok
          ? parsed.blocks.map(b => ({
              handle: b.handle,
              range: b.range,
              type: b.type,
              preview: b.preview,
            }))
          : [],
      }),
    };
  }

  if (!parsed.ok) return { ok: false, failure: parsed.failure };

  const lineStarts = computeLineStarts(content);
  const ctx: ResolveContext = {
    content,
    blocks: parsed.blocks,
    codeRanges: parsed.codeRanges,
    lineStarts,
    totalLines: totalLinesFromStarts(content, lineStarts),
  };

  const resolved: ResolvedOp[] = [];
  for (let i = 0; i < ops.length; i++) {
    const r = resolveOp(ops[i]!, i, ctx);
    if (!r.ok) return { ok: false, failure: r.failure };
    resolved.push(r.resolved);
  }

  const overlapFailure = checkOverlaps(resolved);
  if (overlapFailure) return { ok: false, failure: overlapFailure };

  const newContent = applyResolved(content, resolved);

  if (newContent.length > MAX_CONTENT_LENGTH) {
    return {
      ok: false,
      failure: errors.contentTooLarge({
        current_length: content.length,
        proposed_length: newContent.length,
        max: MAX_CONTENT_LENGTH,
        delta_per_op: resolved.map(r => ({
          index: r.index,
          delta: r.replacement.length - (r.range[1] - r.range[0]),
        })),
      }),
    };
  }

  const newParsed = parseBlocks(newContent, { collectCodeRanges: false });
  return {
    ok: true,
    newContent,
    newRevision: computeRevision(newContent),
    newBlocks: newParsed.ok ? newParsed.blocks : [],
    newLines: makeLines(newContent),
    matchTiers: resolved.map(r => r.matchTier),
  };
}

function resolveOp(
  op: EditOp,
  index: number,
  ctx: ResolveContext,
): { ok: true; resolved: ResolvedOp } | { ok: false; failure: EditFailure } {
  switch (op.kind) {
    case "replace_block":
    case "delete_block": {
      const block = ctx.blocks.find(b => b.handle === op.handle);
      if (!block) {
        return {
          ok: false,
          failure: errors.invalidHandle({
            op_index: index,
            handle: op.handle,
            valid_handles: ctx.blocks.map(b => b.handle),
          }),
        };
      }
      return {
        ok: true,
        resolved: {
          index,
          op,
          range: block.offset_range,
          replacement: op.kind === "replace_block" ? op.content : "",
        },
      };
    }
    case "replace_lines":
    case "delete_lines": {
      const r = resolveLineRange(op.start_line, op.end_line, ctx);
      if (!r.ok) {
        return {
          ok: false,
          failure: errors.invalidRange({
            op_index: index,
            reason: r.reason,
            total_lines: ctx.totalLines,
          }),
        };
      }
      return {
        ok: true,
        resolved: {
          index,
          op,
          range: r.range,
          replacement: op.kind === "replace_lines" ? op.content : "",
        },
      };
    }
    case "insert_after_line": {
      const r = resolveInsertAfterLine(op.line, ctx);
      if (!r.ok) {
        return {
          ok: false,
          failure: errors.invalidRange({
            op_index: index,
            reason: r.reason,
            total_lines: ctx.totalLines,
          }),
        };
      }
      return {
        ok: true,
        resolved: { index, op, range: r.range, replacement: op.content },
      };
    }
    case "replace_text": {
      const m = findMatch({
        content: ctx.content,
        needle: op.old,
        codeRanges: ctx.codeRanges,
        opIndex: index,
        lineStarts: ctx.lineStarts,
      });
      if (!m.ok) return { ok: false, failure: m.failure };
      return {
        ok: true,
        resolved: { index, op, range: m.range, replacement: op.new, matchTier: m.tier },
      };
    }
  }
}

function resolveLineRange(
  startLine: number,
  endLine: number,
  ctx: ResolveContext,
): { ok: true; range: [number, number] } | { ok: false; reason: string } {
  if (ctx.totalLines === 0) {
    return { ok: false, reason: "Note is empty; only insert_after_line(0) is valid." };
  }
  if (startLine < 1) return { ok: false, reason: `start_line must be ≥ 1 (got ${startLine}).` };
  if (endLine < startLine) {
    return { ok: false, reason: `end_line < start_line (${endLine} < ${startLine}).` };
  }
  if (endLine > ctx.totalLines) {
    return {
      ok: false,
      reason: `end_line (${endLine}) exceeds total_lines (${ctx.totalLines}).`,
    };
  }
  const start = ctx.lineStarts[startLine - 1]!;
  const end = endLine >= ctx.totalLines ? ctx.content.length : ctx.lineStarts[endLine]!;
  return { ok: true, range: [start, end] };
}

function resolveInsertAfterLine(
  line: number,
  ctx: ResolveContext,
): { ok: true; range: [number, number] } | { ok: false; reason: string } {
  if (ctx.totalLines === 0) {
    if (line === 0) return { ok: true, range: [0, 0] };
    return { ok: false, reason: `Note is empty; only line=0 is valid (got ${line}).` };
  }
  if (line < 0) return { ok: false, reason: `line must be ≥ 0 (got ${line}).` };
  if (line > ctx.totalLines) {
    return { ok: false, reason: `line (${line}) exceeds total_lines (${ctx.totalLines}).` };
  }
  if (line === 0) return { ok: true, range: [0, 0] };
  const offset = line >= ctx.totalLines ? ctx.content.length : ctx.lineStarts[line]!;
  return { ok: true, range: [offset, offset] };
}

function checkOverlaps(resolved: readonly ResolvedOp[]): EditFailure | null {
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i]!;
      const b = resolved[j]!;
      const [aStart, aEnd] = a.range;
      const [bStart, bEnd] = b.range;
      const aZero = aStart === aEnd;
      const bZero = bStart === bEnd;

      if (aZero && bZero) continue;

      if (aZero) {
        if (aStart > bStart && aStart < bEnd) {
          return errors.overlappingOps([a.index, b.index]);
        }
        continue;
      }
      if (bZero) {
        if (bStart > aStart && bStart < aEnd) {
          return errors.overlappingOps([a.index, b.index]);
        }
        continue;
      }

      if (
        aStart === bStart &&
        aEnd === bEnd &&
        a.op.kind === "replace_text" &&
        b.op.kind === "replace_text"
      ) {
        return errors.duplicateOps([a.index, b.index]);
      }
      if (aStart < bEnd && bStart < aEnd) {
        return errors.overlappingOps([a.index, b.index]);
      }
    }
  }
  return null;
}

function applyResolved(content: string, resolved: ResolvedOp[]): string {
  const ops = resolved.map(r => ({ ...r }));

  // EOF newline rule (design step 6 + E6): if content lacks a trailing '\n'
  // and at least one insert resolves to content.length, prepend '\n' to the
  // FIRST such insert (source-array order). Skip if its content already
  // starts with '\n'. Empty-content bootstrap (C4): content.length === 0 →
  // never enter, so empty notes don't get a phantom leading newline.
  if (content.length > 0 && !content.endsWith("\n")) {
    const eofInserts = ops
      .filter(r => r.range[0] === content.length && r.range[0] === r.range[1])
      .sort((x, y) => x.index - y.index);
    const first = eofInserts[0];
    if (first && !first.replacement.startsWith("\n")) {
      first.replacement = "\n" + first.replacement;
    }
  }

  // Apply in descending start-position order. Tie-break:
  //   non-zero range before zero-width insert at same start (E4 — replace
  //   applies first so insert lands BEFORE the replacement in output).
  //   Among zero-width inserts at the same offset: REVERSE source-array order
  //   (E5 — last source op applied first → first source op ends up earliest
  //   in output).
  ops.sort((a, b) => {
    const posDelta = b.range[0] - a.range[0];
    if (posDelta !== 0) return posDelta;
    const aZero = a.range[0] === a.range[1];
    const bZero = b.range[0] === b.range[1];
    if (aZero !== bZero) return aZero ? 1 : -1;
    return aZero ? b.index - a.index : a.index - b.index;
  });

  let result = content;
  for (const r of ops) {
    const [start, end] = r.range;
    result = result.slice(0, start) + r.replacement + result.slice(end);
  }
  return result;
}

function computeLineStarts(content: string): number[] {
  if (content.length === 0) return [];
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/**
 * `lineStarts.length` already equals total lines under `split("\n")`
 * semantics: one entry for offset 0 plus one per '\n', so `"a\n"` → 2 lines
 * (the second one empty) and `"a\nb"` → 2 lines.
 */
function totalLinesFromStarts(content: string, lineStarts: readonly number[]): number {
  return content.length === 0 ? 0 : lineStarts.length;
}

export function makeLines(content: string): Array<{ line: number; text: string }> {
  if (content.length === 0) return [];
  return content.split("\n").map((text, i) => ({ line: i + 1, text }));
}
