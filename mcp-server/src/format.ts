import type { SparkleItem, StatsResponse } from "./types.js";
import { parseTags, parseAliases } from "./types.js";

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
  lines.push(`*${footer.join(" | ")}*`);

  return lines.join("\n");
}

/** Format a list of items as a compact markdown list */
export function formatItemList(items: SparkleItem[], total: number): string {
  if (items.length === 0) return "No items found.";

  const lines: string[] = [`Found ${total} items (showing ${items.length}):\n`];
  for (const item of items) {
    const tags = parseTags(item);
    const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
    const dueStr = item.due ? ` (due: ${item.due})` : "";
    const priorityStr = item.priority ? ` ⚡${item.priority}` : "";
    lines.push(`- **${item.title}** — ${item.status}${priorityStr}${dueStr}${tagStr}`);
    lines.push(`  ID: ${item.id} | Type: ${item.type} | Modified: ${item.modified}`);
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
