import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchItems } from "../client.js";
import { formatItemList } from "../format.js";

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    "sparkle_search",
    {
      title: "Search Sparkle",
      description: `Full-text search across all Sparkle notes and todos using FTS5.

Searches title and content fields. Supports Chinese characters (trigram tokenizer).
Queries shorter than 3 characters fall back to LIKE matching.

Args:
  - query (string): Search keywords (e.g., "量子計算", "machine learning")
  - limit (number, optional): Max results 1-50, default 20

Returns: List of matching items with title, status, tags, and metadata.`,
      inputSchema: {
        query: z.string().min(1).describe("Search keywords"),
        limit: z.number().int().min(1).max(50).default(20).describe("Max results to return"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, limit }) => {
      try {
        const data = await searchItems(query, limit);
        const text = formatItemList(data.results, data.results.length);
        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error searching: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
