import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getItem, listItems } from "../client.js";
import { buildEditContext, formatItemList, renderItemWithEditContext } from "../format.js";
import { formatToolError } from "../utils.js";

export function registerReadTools(server: McpServer): void {
  server.registerTool(
    "sparkle_get_note",
    {
      title: "Get Sparkle Note",
      description: `Fetch a single item by id or short_id prefix. Returns items_active row (with full content) OR items_vault row (metadata + 500-char content_snippet + vault_path). For full content of vault items, call \`sparkle_read_obsidian\` (by sparkle_id) or \`sparkle_read_obsidian_by_path\` (if you have vault_path). Response includes \`origin: 'active' | 'vault'\` marker.

For active items, the response also includes an \`edit-context\` fenced block with:
  - \`revision\`: sha256 of content (pin this when calling sparkle_edit_note)
  - \`lines\`: 1-indexed line array (use with replace_lines / delete_lines / insert_after_line)
  - \`blocks\`: handle + line range + type + preview for every top-level markdown block (use with replace_block / delete_block)

For vault items, all three fields are \`null\` — vault content is editable only via sparkle_write_obsidian.

Args:
  - id (string): Full UUID or short ID prefix (min 4 chars, e.g. "a4662876")

If the prefix matches rows in both tables, returns 409 Conflict with candidate IDs.`,
      inputSchema: z
        .object({
          id: z.string().min(4).describe("Item UUID or short ID prefix (min 4 chars)"),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      try {
        const item = await getItem(id);
        const ctx = buildEditContext(item.content, item.origin);
        return {
          content: [{ type: "text", text: renderItemWithEditContext(item, ctx) }],
        };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "sparkle_list_notes",
    {
      title: "List Sparkle Notes",
      description: `List notes from items_active with filter support. As of v1.4.0, default excludes vault-exported notes. Pass \`status='exported'\` to list items_vault only (returns metadata + 500-char content_snippet; NOT full content — use \`sparkle_read_obsidian\` for that), or \`include_vault=true\` to merge items_vault rows alongside items_active filter results. For "all notes" search queries, prefer \`sparkle_search_all\`.

Note statuses (items_active): fleeting → developing → permanent → archived
Note-exported (items_vault): \`status='exported'\` synthesized
Todo statuses: active → done → archived
Scratch statuses: draft → archived

Args:
  - status (string, optional): Filter by status ("exported" lists items_vault only; all other values list items_active)
  - tag (string, optional): Filter by tag name (applied to both tables when include_vault=true)
  - type (string, optional): "note", "todo", or "scratch", default "note" (todo/scratch skip vault — those types don't exist there)
  - category_id (string, optional): Filter by category UUID
  - paused (string, optional): 篩選暫停狀態 — "true"（僅暫停）、"false"（僅未暫停）、"all"（全部，預設）
  - include_vault (boolean, optional): If true, merge items_vault rows into the result (default false). Mutually exclusive with status='exported'.
  - sort (string, optional): "created", "modified", "priority", or "due" (default: "created"). For vault rows: "modified" maps to exported_at; "priority"/"due" sort vault rows as null.
  - order (string, optional): "asc" or "desc" (default: "desc")
  - limit (number, optional): Max results 1-100, default 50
  - offset (number, optional): Pagination offset, default 0

Returns: List of items with total count and pagination info.`,
      inputSchema: z
        .object({
          status: z
            .enum([
              "fleeting",
              "developing",
              "permanent",
              "exported",
              "active",
              "done",
              "draft",
              "archived",
            ])
            .optional()
            .describe("Filter by status"),
          tag: z.string().optional().describe("Filter by tag name"),
          type: z.enum(["note", "todo", "scratch"]).default("note").describe("Item type"),
          category_id: z.string().uuid().optional().describe("Filter by category UUID"),
          paused: z
            .enum(["true", "false", "all"])
            .optional()
            .describe("篩選暫停狀態 (default: all)"),
          include_vault: z
            .boolean()
            .optional()
            .describe(
              "Merge items_vault rows alongside active-table results (default false). Mutually exclusive with status='exported'.",
            ),
          sort: z
            .enum(["created", "modified", "priority", "due"])
            .default("created")
            .describe("Sort field"),
          order: z.enum(["asc", "desc"]).default("desc").describe("Sort order"),
          limit: z.number().int().min(1).max(100).default(50).describe("Max results"),
          offset: z.number().int().min(0).default(0).describe("Pagination offset"),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ status, tag, type, category_id, paused, include_vault, sort, order, limit, offset }) => {
      try {
        const data = await listItems({
          status,
          tag,
          type,
          category_id,
          paused,
          include_vault,
          sort,
          order,
          limit,
          offset,
        });
        const text = formatItemList(data.items, data.total, { offset, limit });
        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );
}
