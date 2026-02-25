import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getStats, getTags } from "../client.js";
import { formatStats, formatTags } from "../format.js";

export function registerMetaTools(server: McpServer): void {
  server.registerTool(
    "sparkle_get_stats",
    {
      title: "Get Sparkle Stats",
      description: `Get knowledge base statistics: note counts by maturity stage, todo counts, weekly/monthly activity, overdue count.

No args required.

Returns: Zettelkasten note counts (fleeting/developing/permanent), GTD todo counts (active/done/overdue), and activity metrics (exports/completions/creations this week and month).`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const stats = await getStats();
        const text = formatStats(stats);
        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "sparkle_list_tags",
    {
      title: "List Sparkle Tags",
      description: `List all tags currently in use across all notes and todos.

No args required.

Returns: Array of tag names. Use these for filtering with sparkle_list_notes or when creating/updating notes to maintain consistent tagging.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const data = await getTags();
        const text = formatTags(data.tags);
        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
