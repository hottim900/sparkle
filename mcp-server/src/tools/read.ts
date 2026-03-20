import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getItem, listItems } from "../client.js";
import { formatItem, formatItemList } from "../format.js";
import { formatToolError } from "../utils.js";

export function registerReadTools(server: McpServer): void {
  server.registerTool(
    "sparkle_get_note",
    {
      title: "Get Sparkle Note",
      description: `Read a single Sparkle note or todo by ID. Supports full UUID or short ID prefix (min 4 chars, e.g. "a4662876").

Args:
  - id (string): Full UUID or short ID prefix (min 4 chars)

Returns: Full item with title, content, status, tags, aliases, linked items, and metadata.
If prefix matches multiple items, returns error with candidate IDs.`,
      inputSchema: z.object({
        id: z.string().min(4).describe("Item UUID or short ID prefix (min 4 chars)"),
      }).strict(),
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
        const text = formatItem(item);
        return {
          content: [{ type: "text", text }],
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
      description: `List Sparkle notes with optional filters. Default: all notes sorted by creation date (newest first).

Note statuses: fleeting → developing → permanent → exported → archived
Todo statuses: active → done → archived
Scratch statuses: draft → archived

Args:
  - status (string, optional): Filter by status
  - tag (string, optional): Filter by tag name
  - type (string, optional): "note", "todo", or "scratch", default "note"
  - category_id (string, optional): Filter by category UUID
  - sort (string, optional): "created", "modified", "priority", or "due" (default: "created")
  - order (string, optional): "asc" or "desc" (default: "desc")
  - limit (number, optional): Max results 1-100, default 50
  - offset (number, optional): Pagination offset, default 0

Returns: List of items with total count and pagination info.`,
      inputSchema: z.object({
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
        sort: z
          .enum(["created", "modified", "priority", "due"])
          .default("created")
          .describe("Sort field"),
        order: z.enum(["asc", "desc"]).default("desc").describe("Sort order"),
        limit: z.number().int().min(1).max(100).default(50).describe("Max results"),
        offset: z.number().int().min(0).default(0).describe("Pagination offset"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ status, tag, type, category_id, sort, order, limit, offset }) => {
      try {
        const data = await listItems({ status, tag, type, category_id, sort, order, limit, offset });
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
