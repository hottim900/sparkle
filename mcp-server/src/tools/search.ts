import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchItems } from "../client.js";
import { formatItemList } from "../format.js";
import { searchVault } from "../vault.js";
import { formatSearchResults } from "./vault.js";

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

  server.registerTool(
    "sparkle_search_all",
    {
      title: "Search All",
      description: `Search across both Sparkle database and Obsidian vault simultaneously.

Runs both searches in parallel. Automatically deduplicates: exported notes found in the vault are only shown in the Vault section. If Obsidian integration is not enabled, gracefully falls back to Sparkle-only results.

Args:
  - query (string): Search keywords
  - limit (number, optional): Max results per source (default 20, max 50)

Returns: Results grouped by source — [Sparkle] for database items, [Vault] for vault files.`,
      inputSchema: {
        query: z.string().min(1).describe("Search keywords"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Max results per source (default 20)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, limit }) => {
      const [sparkleResult, vaultResult] = await Promise.allSettled([
        searchItems(query, limit),
        searchVault(query, { limit }),
      ]);

      const sparkleItems =
        sparkleResult.status === "fulfilled" ? sparkleResult.value.results : [];
      const vaultResults = vaultResult.status === "fulfilled" ? vaultResult.value : [];

      // Dedup: remove exported items that appear in vault results
      const vaultSparkleIds = new Set(
        vaultResults
          .map((r) => r.frontmatter.sparkle_id)
          .filter((id): id is string => typeof id === "string"),
      );
      const uniqueSparkleItems = sparkleItems.filter(
        (item) => !(item.status === "exported" && vaultSparkleIds.has(item.id)),
      );

      const sections: string[] = [];

      if (uniqueSparkleItems.length > 0) {
        sections.push(`## [Sparkle] (${uniqueSparkleItems.length} items)\n`);
        sections.push(formatItemList(uniqueSparkleItems, uniqueSparkleItems.length));
      }

      if (vaultResults.length > 0) {
        sections.push(`\n## [Vault] (${vaultResults.length} files)\n`);
        sections.push(formatSearchResults(vaultResults, query));
      }

      if (sections.length === 0) {
        const errors: string[] = [];
        if (sparkleResult.status === "rejected")
          errors.push(
            `Sparkle: ${sparkleResult.reason instanceof Error ? sparkleResult.reason.message : String(sparkleResult.reason)}`,
          );
        if (vaultResult.status === "rejected")
          errors.push(
            `Vault: ${vaultResult.reason instanceof Error ? vaultResult.reason.message : String(vaultResult.reason)}`,
          );
        if (errors.length > 0) {
          return {
            content: [{ type: "text", text: `Search failed:\n${errors.join("\n")}` }],
            isError: true,
          };
        }
        return {
          content: [
            { type: "text", text: `No results found for "${query}" in Sparkle or Vault.` },
          ],
        };
      }

      return { content: [{ type: "text", text: sections.join("\n") }] };
    },
  );
}
