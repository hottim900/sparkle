/**
 * Structured failure payloads for sparkle_edit_note.
 *
 * Each variant carries the recovery context the LLM needs to fix itself
 * without round-tripping through sparkle_get_note again. The MCP tool layer
 * stringifies these into the `text` field of an `isError: true` response.
 */

import type { BlockType } from "./block-parser.js";

/** Code-unit half-open range `[start, end)` in JS-string units. */
export type Range = readonly [number, number];

export interface MatchLocation {
  /** 1-indexed line where the match starts. */
  start_line: number;
  /** 1-indexed line where the match ends (inclusive). */
  end_line: number;
  /** Up to 80 characters of context for LLM disambiguation. */
  preview: string;
}

/** Block payload exposed in REVISION_MISMATCH (offset_range stripped — DX-D6). */
export interface BlockPayload {
  handle: string;
  range: [number, number];
  type: BlockType;
  preview: string;
}

/**
 * VAULT_READONLY is intentionally NOT a member of this union: the tool layer
 * (`mcp-server/src/lib/vault-readonly.ts`) pre-empts vault-origin items with
 * the canonical payload shape (vault_path, vault_path_source, hint_tool_*,
 * doc_url) before reaching `applyEdits`. EditFailure carries only the
 * codes that `applyEdits` itself can emit.
 */
export type EditFailure =
  | {
      code: "REVISION_MISMATCH";
      current_revision: string;
      lines: Array<{ line: number; text: string }>;
      blocks: BlockPayload[];
      hint: string;
    }
  | {
      code: "NO_MATCH";
      op_index: number;
      old_preview: string;
      closest_match: string | null;
      diff: string | null;
      tier_attempted: "exact" | "punctuation_normalized";
      hint: string;
    }
  | {
      code: "AMBIGUOUS_MATCH";
      op_index: number;
      match_tier: "exact" | "punctuation_normalized";
      locations: MatchLocation[];
      hint: string;
    }
  | {
      code: "INVALID_HANDLE";
      op_index: number;
      handle: string;
      valid_handles: string[];
      hint: string;
    }
  | {
      code: "INVALID_RANGE";
      op_index: number;
      reason: string;
      total_lines: number;
      hint: string;
    }
  | {
      code: "EMPTY_OPS";
      hint: string;
    }
  | {
      code: "TOO_MANY_OPS";
      ops_count: number;
      max: number;
      hint: string;
    }
  | {
      code: "OVERLAPPING_OPS";
      op_indices: [number, number];
      hint: string;
    }
  | {
      code: "DUPLICATE_OPS";
      op_indices: [number, number];
      hint: string;
    }
  | {
      code: "CONTENT_TOO_LARGE";
      current_length: number;
      proposed_length: number;
      max: number;
      delta_per_op: Array<{ index: number; delta: number }>;
      hint: string;
    }
  | {
      code: "PARSE_ERROR";
      reason: string;
      hint: string;
    };

const HINT_REVISION_MISMATCH =
  "The note changed since you last fetched it. Use the revision/lines/blocks payload below to retarget your ops; do not reuse the previous handles.";

const HINT_NO_MATCH =
  "Tier-1 (exact) and Tier-2 (CJK ↔ ASCII punctuation fold) both failed. Compare closest_match against your old_preview, fix the divergent characters, and retry — or switch to replace_block / replace_lines.";

const HINT_AMBIGUOUS =
  "More than one location matches. Add unique surrounding context to your old/new strings, or address the change with replace_block (handle) / replace_lines (line range).";

const HINT_INVALID_HANDLE =
  "Block handles are revision-scoped: every successful edit returns fresh handles. Re-fetch via sparkle_get_note (or use the handles returned by the previous successful call) before retrying.";

const HINT_INVALID_RANGE =
  "Line numbers are 1-indexed (line=0 is reserved for insert_after_line as 'prepend'). Confirm total_lines against the latest revision.";

const HINT_EMPTY_OPS = "ops must contain at least one op.";

const HINT_OVERLAPPING =
  "Two ops resolve to ranges that share at least one code unit. Either drop one of them, or move one to a non-conflicting region.";

const HINT_DUPLICATE =
  "Two replace_text ops resolve to the identical range. Keep one and remove the duplicate.";

const HINT_PARSE_ERROR =
  "Markdown parser could not segment the current content. The edit was rejected to avoid corrupting blocks. Inspect the note manually or rewrite the section via replace_lines (which does not depend on block parsing).";

export function revisionMismatch(args: {
  current_revision: string;
  lines: Array<{ line: number; text: string }>;
  blocks: BlockPayload[];
}): EditFailure {
  return { ...args, code: "REVISION_MISMATCH", hint: HINT_REVISION_MISMATCH };
}

export function noMatch(args: {
  op_index: number;
  old_preview: string;
  closest_match: string | null;
  diff: string | null;
  tier_attempted: "exact" | "punctuation_normalized";
}): EditFailure {
  return { ...args, code: "NO_MATCH", hint: HINT_NO_MATCH };
}

export function ambiguousMatch(args: {
  op_index: number;
  match_tier: "exact" | "punctuation_normalized";
  locations: MatchLocation[];
}): EditFailure {
  return { ...args, code: "AMBIGUOUS_MATCH", hint: HINT_AMBIGUOUS };
}

export function invalidHandle(args: {
  op_index: number;
  handle: string;
  valid_handles: string[];
}): EditFailure {
  return { ...args, code: "INVALID_HANDLE", hint: HINT_INVALID_HANDLE };
}

export function invalidRange(args: {
  op_index: number;
  reason: string;
  total_lines: number;
}): EditFailure {
  return { ...args, code: "INVALID_RANGE", hint: HINT_INVALID_RANGE };
}

export function emptyOps(): EditFailure {
  return { code: "EMPTY_OPS", hint: HINT_EMPTY_OPS };
}

export function tooManyOps(args: { ops_count: number; max: number }): EditFailure {
  return {
    ...args,
    code: "TOO_MANY_OPS",
    hint: `Split the batch into smaller sparkle_edit_note calls — a single call accepts at most ${args.max} ops.`,
  };
}

export function overlappingOps(op_indices: [number, number]): EditFailure {
  return { code: "OVERLAPPING_OPS", op_indices, hint: HINT_OVERLAPPING };
}

export function duplicateOps(op_indices: [number, number]): EditFailure {
  return { code: "DUPLICATE_OPS", op_indices, hint: HINT_DUPLICATE };
}

export function contentTooLarge(args: {
  current_length: number;
  proposed_length: number;
  max: number;
  delta_per_op: Array<{ index: number; delta: number }>;
}): EditFailure {
  return {
    ...args,
    code: "CONTENT_TOO_LARGE",
    hint: `The combined post-edit content exceeds the ${args.max}-character note cap. Trim the largest contributor in delta_per_op, then retry.`,
  };
}

export function parseError(reason: string): EditFailure {
  return { code: "PARSE_ERROR", reason, hint: HINT_PARSE_ERROR };
}

/**
 * Render an EditFailure as a single text payload for the MCP tool response.
 * Format matches `vaultReadonlyResponse` (raw pretty JSON with `code` as a
 * top-level discriminator), so LLMs see one consistent shape across every
 * `sparkle_edit_note` failure path.
 */
export function renderFailure(failure: EditFailure): string {
  return JSON.stringify(failure, null, 2);
}
