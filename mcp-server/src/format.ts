import type { SparkleItem, StatsResponse } from "./types.js";
import { parseTags, parseAliases } from "./types.js";
import { type Block, type BlockType, parseBlocks } from "./edit/block-parser.js";
import { computeRevision } from "./edit/revision.js";
import { makeLines } from "./edit/ops.js";
import type { BlockPayload } from "./edit/errors.js";
import type { MatchTier } from "./edit/fuzzy.js";

/**
 * Edit context block appended to sparkle_get_note / sparkle_create_note /
 * sparkle_edit_note responses. Each field is `null` for vault-origin rows
 * (items_vault stores only a 500-char snippet — editing requires
 * sparkle_write_obsidian against the vault .md).
 *
 * `match_tiers` is only present in sparkle_edit_note success responses; it
 * mirrors `ops[]` (one slot per op) and is `null` for non-replace_text ops.
 */
export interface EditContextPayload {
  revision: string | null;
  lines: Array<{ line: number; text: string }> | null;
  blocks: BlockPayload[] | null;
  match_tiers?: Array<MatchTier | null>;
}

export type { BlockType };

/** Strip `offset_range` from a Block — that field is server-internal only (DX-D6). */
export function blockToPayload(b: Block): BlockPayload {
  return { handle: b.handle, range: b.range, type: b.type, preview: b.preview };
}

/**
 * Build the `edit-context` payload for an item. Vault rows have null fields
 * because items_vault holds only a 500-char snippet; the vault .md is the
 * authoritative source and is editable only via sparkle_write_obsidian.
 *
 * Uses `collectCodeRanges: false` — read-path callers don't need the Tier-2
 * exclusion mask (only sparkle_edit_note's apply path consumes it).
 */
export function buildEditContext(content: string, origin: string): EditContextPayload {
  if (origin === "vault") return { revision: null, lines: null, blocks: null };
  const parsed = parseBlocks(content, { collectCodeRanges: false });
  return {
    revision: computeRevision(content),
    lines: makeLines(content),
    blocks: parsed.ok ? parsed.blocks.map(blockToPayload) : [],
  };
}

/**
 * Render the edit context as a fenced code block tagged `edit-context`.
 * LLMs can either treat the surrounding markdown as content and the block as
 * structured metadata, or grep for `revision`/`blocks` directly.
 */
export function formatEditContext(ctx: EditContextPayload): string {
  return "```edit-context\n" + JSON.stringify(ctx, null, 2) + "\n```";
}

/**
 * Compose `formatItem(item) + formatEditContext(...)` — the standard
 * response shape for sparkle_get_note, sparkle_create_note, and
 * sparkle_edit_note. The caller pre-merges optional fields like
 * `match_tiers` into `ctx`.
 */
export function renderItemWithEditContext(
  item: SparkleItem,
  ctx: EditContextPayload,
): string {
  return `${formatItem(item)}\n\n${formatEditContext(ctx)}`;
}

/** Format a single item as markdown */
export function formatItem(item: SparkleItem): string {
  const tags = parseTags(item);
  const aliases = parseAliases(item);
  const lines: string[] = [];

  lines.push(`# ${item.title}`);
  const meta: string[] = [`**Status**: ${item.status}`];
  if (tags.length > 0) meta.push(`**Tags**: ${tags.join(", ")}`);
  if (item.priority) meta.push(`**Priority**: ${item.priority}`);
  if (item.due) meta.push(`**Due**: ${item.due}`);
  lines.push(meta.join(" | "));

  if (aliases.length > 0) {
    lines.push(`**Aliases**: ${aliases.join(", ")}`);
  }
  if (item.source) {
    lines.push(`**Source**: ${item.source}`);
  }

  if (item.content) {
    lines.push("");
    lines.push(item.content);
  }

  lines.push("");
  lines.push("---");
  const footer: string[] = [
    `ID: ${item.id}`,
    `Type: ${item.type}`,
    `Created: ${item.created}`,
    `Modified: ${item.modified}`,
    `Origin: ${item.origin || "web"}`,
  ];
  if (item.type === "note" && item.linked_todo_count > 0) {
    footer.push(`Linked todos: ${item.linked_todo_count}`);
  }
  if (item.type === "todo" && item.linked_note_title) {
    footer.push(`Linked note: ${item.linked_note_title}`);
  }
  if (item.category_name) {
    footer.push(`Category: ${item.category_name}`);
  }
  if (item.share_visibility) {
    footer.push(`Shared: ${item.share_visibility}`);
  }
  if (item.paused) {
    footer.push(`Paused: ${item.paused_at ?? "yes"}`);
    if (item.paused_context) {
      footer.push(`Paused context: ${item.paused_context}`);
    }
  }
  lines.push(`*${footer.join(" | ")}*`);

  return lines.join("\n");
}

/** Format a list of items as a compact markdown list */
export function formatItemList<T extends SparkleItem>(
  items: T[],
  total: number,
  pagination?: { offset: number; limit: number },
  options?: {
    emptyMessage?: string;
    formatLine?: (item: T, shared: { tagStr: string; catStr: string }) => string;
  },
): string {
  if (items.length === 0) return options?.emptyMessage ?? "No items found.";

  const lines: string[] = [`Found ${total} items (showing ${items.length}):\n`];
  for (const item of items) {
    const tags = parseTags(item);
    const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
    const catStr = item.category_name ? ` 📁${item.category_name}` : "";
    if (options?.formatLine) {
      lines.push(options.formatLine(item, { tagStr, catStr }));
    } else {
      const dueStr = item.due ? ` (due: ${item.due})` : "";
      const priorityStr = item.priority ? ` ⚡${item.priority}` : "";
      const pausedStr = item.paused ? " ⏸️paused" : "";
      lines.push(
        `- **${item.title}** — ${item.status}${priorityStr}${dueStr}${pausedStr}${catStr}${tagStr}`,
      );
    }
    lines.push(`  ID: ${item.id} | Type: ${item.type} | Modified: ${item.modified}`);
  }
  if (pagination) {
    const hasMore = pagination.offset + pagination.limit < total;
    const nextOffset = pagination.offset + pagination.limit;
    lines.push(
      `\nOffset: ${pagination.offset} | Limit: ${pagination.limit} | Has more: ${hasMore ? "yes" : "no"} | Next offset: ${nextOffset}`,
    );
  }
  return lines.join("\n");
}

/** Format stats as markdown */
export function formatStats(stats: StatsResponse): string {
  return [
    "# Sparkle Knowledge Base Stats\n",
    "## Zettelkasten Notes",
    `- Fleeting: **${stats.fleeting_count}**`,
    `- Developing: **${stats.developing_count}**`,
    `- Permanent: **${stats.permanent_count}**`,
    `- Exported this week: ${stats.exported_this_week} | this month: ${stats.exported_this_month}`,
    "",
    "## GTD Todos",
    `- Active: **${stats.active_count}**`,
    `- Overdue: **${stats.overdue_count}**`,
    `- Done this week: ${stats.done_this_week} | this month: ${stats.done_this_month}`,
    "",
    "## Activity",
    `- Created this week: ${stats.created_this_week} | this month: ${stats.created_this_month}`,
  ].join("\n");
}

/** Format tags as markdown */
export function formatTags(tags: string[]): string {
  if (tags.length === 0) return "No tags found.";
  return [`Found ${tags.length} tags:\n`, ...tags.map(t => `- ${t}`)].join("\n");
}
