import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchItems } from "../client.js";
import { formatItemList } from "../format.js";
import { formatToolError } from "../utils.js";
import { searchVault } from "../vault.js";
import { formatSearchResults } from "./vault.js";

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    "sparkle_search",
    {
      title: "Search Sparkle",
      description: `Full-text search over items_active (fleeting/developing/permanent/archived). As of v1.4.0, exported notes live in items_vault — for vault content, use \`sparkle_search_obsidian\` (vault FTS via obsidian-cli) or \`sparkle_search_all\` (union of DB + vault).

Searches title and content fields. Supports Chinese characters (trigram tokenizer).
Queries shorter than 3 characters fall back to LIKE matching.

**ID lookup syntax**: prefix the query with \`id:\` to find a note by its Sparkle ID.
  - \`id:<full-uuid>\` → exact match (36-char canonical UUID with dashes)
  - \`id:abc12345\` → 4–32 hex-char prefix lookup (dashes optional — \`id:abc12345-1111\` works too; they're stripped before validation)
  - Searches across BOTH items_active + items_vault (so you can locate exported notes too).
  - Returns 0 results on non-hex chars or <4-char prefix after dash stripping — no silent FTS fallback.

Args:
  - query (string): Search keywords (e.g., "量子計算", "machine learning") OR \`id:<prefix>\`
  - limit (number, optional): Max results 1-50, default 20

Returns: List of matching items with title, status, tags, and metadata.`,
      inputSchema: z.object({
        query: z.string().min(1).describe("Search keywords"),
        limit: z.number().int().min(1).max(50).default(20).describe("Max results to return"),
      }).strict(),
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
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "sparkle_search_all",
    {
      title: "Search All",
      description: `Search across both Sparkle database and Obsidian vault simultaneously.

Runs both searches in parallel. Automatically deduplicates: exported notes found in the vault are only shown in the Vault section. If Obsidian integration is not enabled, gracefully falls back to Sparkle-only results.

**ID lookup syntax** (same as \`sparkle_search\`): prefix the query with \`id:\` to find a note by Sparkle ID across items_active + items_vault. Vault filesystem search is skipped for \`id:\` queries (vault files are keyed by title, not ID).

Args:
  - query (string): Search keywords OR \`id:<prefix>\`
  - limit (number, optional): Max results per source (default 20, max 50)

Returns: Results grouped by source — [Sparkle] for database items, [Vault] for vault files.`,
      inputSchema: z.object({
        query: z.string().min(1).describe("Search keywords"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .describe("Max results per source (default 20)"),
      }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, limit }) => {
      // Keep in sync with `ID_PREFIX_QUERY_RE` in server/lib/items.ts — when
      // that loosens or tightens, this must too. Vault filesystem search keys
      // by title/content (not Sparkle ID), so skip it for id: queries.
      const isIdQuery = /^id:\s*\S+\s*$/i.test(query.trim());

      const [sparkleResult, vaultResult] = await Promise.allSettled([
        searchItems(query, limit),
        isIdQuery ? Promise.resolve([]) : searchVault(query, { limit }),
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
