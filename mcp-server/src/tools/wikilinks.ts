import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolveWikilink,
  rebuildReferenceIndex,
  listTitleCollisions,
  listRecentRenames,
  undoRenameApi,
  previewRename,
} from "../client.js";
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

  server.registerTool(
    "sparkle_list_title_collisions",
    {
      title: "List Duplicate-Title Items (Admin)",
      description: `List groups of items_active rows that share a normalized title. These are pre-Pre-PR0e duplicates that slipped in before write-time uniqueness enforcement (PR 5) — new writes are blocked by \`TITLE_COLLISION\`, but legacy duplicates need manual reconciliation (rename or merge).

Allowlist titles (\`未命名\`) are excluded — duplicate fleeting captures with the placeholder are legal.

Use when an operator asks "show me the duplicate-title items so I can clean them up" or when planning a rename — collisions block the rename engine's resolver path.

Returns: \`{ collisions: [{ normalized, rows: [{ id, title, type, status, modified }] }], total }\`. Rows within each group are sorted by \`modified DESC\` (newest first).`,
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const result = await listTitleCollisions();
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  server.registerTool(
    "sparkle_list_recent_renames",
    {
      title: "List Recent Title Renames (Admin)",
      description: `List the most recent N entries from \`rename_history\` for audit. Each row records a title change with \`source_count\` (how many sources were swept) and \`performed_by\` ("user", "system", or "undo:<originalId>" for undo rows — the audit log is append-only).

Rows older than 30 days are pruned by the daily cleanup cron — for older history, use git/backup.

Args:
  - limit (1-200, default 50): How many entries to return, newest first.

Returns: \`{ renames: [{ id, target_id, old_title, new_title, source_count, performed_at, performed_by }] }\`.`,
      inputSchema: z
        .object({
          limit: z.number().int().min(1).max(200).optional().describe("Max entries (default 50)"),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ limit }) => {
      try {
        const result = await listRecentRenames(limit);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  server.registerTool(
    "sparkle_undo_rename",
    {
      title: "Undo a Title Rename (Admin)",
      description: `Replay the inverse of a recorded rename: target title flips back to \`old_title\` AND every source still citing \`new_title\` is rewritten to \`old_title\`. A NEW \`rename_history\` row is appended for the undo itself (\`performed_by = "undo:<originalId>"\`) so the audit log stays append-only.

The history id comes from \`sparkle_list_recent_renames\`. Returns 404 if the history id doesn't exist (likely pruned by the 30-day cleanup).

Args:
  - history_id (string, required): \`rename_history.id\` from \`sparkle_list_recent_renames\`.

Returns: \`{ status: "undone", historyId, rewrittenCount, rewrittenSourceIds }\`.`,
      inputSchema: z
        .object({
          history_id: z.string().min(1).describe("rename_history.id to undo"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ history_id }) => {
      try {
        const result = await undoRenameApi(history_id);
        logger.info(
          { historyId: history_id, rewrittenCount: result.rewrittenCount },
          "sparkle_undo_rename applied",
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    },
  );

  server.registerTool(
    "sparkle_preview_rename",
    {
      title: "Preview a Title Rename (Dry-Run, DX-2)",
      description: `Stateless dry-run preview for a title rename. Returns the count and a sample of the sources that WOULD be rewritten if the rename committed, plus any sources that would be skipped by the share-token leak guard (ENG-3). No state is written; agents commit by calling \`sparkle_update_note({ id, title })\` separately.

Use this before a title change so the user can review the impact ("this will rewrite 7 other notes — proceed?"). Especially valuable for hub notes with many backlinks.

Args:
  - target_id (UUID, required): The item whose title is changing.
  - new_title (string, required): The proposed new title.

Returns: \`{ target_id, old_title, new_title, would_rewrite_count, would_rewrite_source_ids, would_skip_share_token_source_ids, preview: [{source_id, source_title, snippet}] }\`. Preview is capped at 5 entries — the full list is in \`would_rewrite_source_ids\`.`,
      inputSchema: z
        .object({
          target_id: z.string().uuid().describe("Item UUID whose title will change"),
          new_title: z.string().min(1).max(256).describe("Proposed new title"),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ target_id, new_title }) => {
      try {
        const result = await previewRename(target_id, new_title);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return formatToolError(err);
      }
    },
  );
}
