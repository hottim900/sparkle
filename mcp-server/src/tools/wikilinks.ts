import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveWikilink, rebuildReferenceIndex } from "../client.js";
import { formatToolError } from "../utils.js";
import { logger } from "../logger.js";

export function registerWikilinkTools(server: McpServer): void {
  server.registerTool(
    "sparkle_resolve_wikilink",
    {
      title: "Resolve Wikilink to Sparkle Item",
      description: `Resolve a \`[[Title]]\` style cross-reference to a Sparkle item. Use this when the user (or your own draft content) contains a \`[[Some Title]]\` and you need the underlying item to read its body or link to it.

Returns the resolved item's id, title, origin (active or vault), and a 200-codepoint snippet. Returns \`{ resolved: false }\` when:
  - no item carries this title, OR
  - the title collides (e.g. two notes named "未命名" — the allowlisted fleeting default).

Resolution rules (locked, do not work around):
  - Normalization: NFC + trim + ASCII case-insensitive. \`Café\` (composed) and \`Café\` (decomposed) resolve to the same row. \`Foo\` and \`foo\` collide; \`半形ABC\` and \`全形ＡＢＣ\` are distinct.
  - Active-priority: when a title exists in both items_active and items_vault, the active row wins.
  - Collision returns null: when the resolver finds > 1 active match (or > 1 vault match in the active-empty branch), it returns null rather than picking arbitrarily — render or report as "unresolved" and ask the user to disambiguate.

Args:
  - title (string, required, 1-256 chars): the title inside \`[[...]]\`, without the brackets.`,
      inputSchema: z
        .object({
          title: z
            .string()
            .min(1)
            .max(256)
            .describe("Title inside `[[…]]` to resolve. Trimmed, NFC-normalized server-side."),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const resolved = await resolveWikilink(args.title);
        if (!resolved) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ resolved: false, title: args.title }, null, 2),
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ resolved: true, ...resolved }, null, 2),
            },
          ],
        };
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  server.registerTool(
    "sparkle_rebuild_reference_index",
    {
      title: "Rebuild Wikilink Reference Index (Admin)",
      description: `Disaster-recovery: truncate \`reference_index\` and re-prime every items_active row for reindex. The background worker drains the queue in 50-row batches every 60s, so a full rebuild on N items takes ceil(N/50) minutes.

Use when:
  - the resolver returns surprising results (parser bug fix that needs to re-derive),
  - manual SQL edits to items_active.content happened outside the normal write path,
  - schema migration left orphaned reference_index rows.

Do NOT use as a routine refresh — write hooks already keep the index live.

Returns: \`{ status: "queued", queued: <row count> }\`.`,
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const result = await rebuildReferenceIndex();
        logger.info({ queued: result.queued }, "sparkle_rebuild_reference_index queued");
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    },
  );
}
