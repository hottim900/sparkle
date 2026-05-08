import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import type { Nodes } from "mdast";
import { parseError, type EditFailure } from "./errors.js";

const GFM_EXTENSIONS = [gfmTable()];
const GFM_AST_EXTENSIONS = [gfmTableFromMarkdown()];

/** Discriminator for block kinds — kebab-case for cleaner JSON output. */
export type BlockType =
  | "paragraph"
  | "heading"
  | "code_block"
  | "list"
  | "table"
  | "blockquote"
  | "thematic_break"
  | "html";

/**
 * One revision-scoped block returned by parseBlocks. Handles look like
 * `b<seq>` where `seq` is the 0-indexed position among emitted blocks. Both
 * `range` (1-indexed inclusive lines) and `offset_range` (half-open UTF-16
 * code units) point into the same content the caller passed in.
 */
export interface Block {
  handle: string;
  range: [number, number];
  offset_range: [number, number];
  type: BlockType;
  preview: string;
}

export interface ParseSuccess {
  ok: true;
  blocks: Block[];
  /**
   * Half-open `[start, end)` UTF-16 code-unit ranges of every fenced and
   * inline code region in the document — used as the Tier-2 exclusion mask
   * by replace_text fuzzy matching. Includes code nested inside lists,
   * blockquotes, table cells, etc.
   *
   * Empty when `parseBlocks` was called with `{ collectCodeRanges: false }`.
   */
  codeRanges: Array<[number, number]>;
}

export interface ParseFailure {
  ok: false;
  failure: EditFailure;
}

export type ParseResult = ParseSuccess | ParseFailure;

export interface ParseOptions {
  /**
   * When `false`, skip the recursive AST walk that gathers fenced-code +
   * inline-code regions. Defaults to `true` because Tier-2 fuzzy match
   * needs the exclusion mask. Read-only paths (sparkle_get_note's
   * edit-context block) pass `false` to avoid the per-read walk.
   */
  collectCodeRanges?: boolean;
}

const NODE_TYPE_MAP: Readonly<Record<string, BlockType>> = Object.freeze({
  paragraph: "paragraph",
  heading: "heading",
  code: "code_block",
  list: "list",
  table: "table",
  blockquote: "blockquote",
  thematicBreak: "thematic_break",
  html: "html",
});

const PREVIEW_LENGTH = 80;

export function parseBlocks(content: string, options: ParseOptions = {}): ParseResult {
  const collectCodeRanges = options.collectCodeRanges ?? true;
  let root: ReturnType<typeof fromMarkdown>;
  try {
    root = fromMarkdown(content, {
      extensions: GFM_EXTENSIONS,
      mdastExtensions: GFM_AST_EXTENSIONS,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, failure: parseError(reason) };
  }

  const blocks: Block[] = [];
  let seq = 0;
  for (const node of root.children) {
    const blockType = NODE_TYPE_MAP[node.type];
    if (!blockType) continue;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    const startLine = node.position?.start.line;
    const endLine = node.position?.end.line;
    if (start === undefined || end === undefined || startLine === undefined || endLine === undefined) {
      continue;
    }
    blocks.push({
      handle: `b${seq++}`,
      range: [startLine, endLine],
      offset_range: [start, end],
      type: blockType,
      preview: content.slice(start, Math.min(end, start + PREVIEW_LENGTH)),
    });
  }

  if (!collectCodeRanges) {
    return { ok: true, blocks, codeRanges: [] };
  }

  const codeRanges: Array<[number, number]> = [];
  walk(root as Nodes, node => {
    if (node.type !== "code" && node.type !== "inlineCode") return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    codeRanges.push([start, end]);
  });

  return { ok: true, blocks, codeRanges };
}

function walk(node: Nodes, visit: (n: Nodes) => void): void {
  visit(node);
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) walk(child as Nodes, visit);
  }
}
