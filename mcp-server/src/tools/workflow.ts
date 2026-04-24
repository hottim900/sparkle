import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getItem, updateItem, exportToObsidian, releaseVaultNote } from "../client.js";
import { formatItem } from "../format.js";
import { formatToolError } from "../utils.js";

export function registerWorkflowTools(server: McpServer): void {
  server.registerTool(
    "sparkle_advance_note",
    {
      title: "Advance Note Maturity",
      description: `Advance an items_active note along the maturity path (fleeting → developing → permanent). Not applicable to vault items (no status field) — returns \`VAULT_READONLY\`. Once a note is exported (moved to items_vault), its maturity journey in Sparkle is complete.

Valid progressions:
  - fleeting → developing (note has been expanded with initial thoughts)
  - developing → permanent (note is well-developed and complete)

Args:
  - id (string, required): Note UUID
  - target_status (string, required): "developing" or "permanent"

Returns: The updated note.`,
      inputSchema: z.object({
        id: z.string().uuid().describe("Note UUID"),
        target_status: z.enum(["developing", "permanent"]).describe("Target maturity status"),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, target_status }) => {
      try {
        // Validate the note exists and is in the right state
        const current = await getItem(id);

        // v1.4.0: vault-origin items have no maturity journey in Sparkle
        if ((current as { origin?: string }).origin === "vault") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  code: "VAULT_READONLY",
                  error: "此項目為 vault-origin，無法 advance（成熟度路線只適用於 items_active）",
                  error_en: "Vault items have no maturity status; advance_note does not apply.",
                  vault_path: (current as { export_path?: string | null }).export_path ?? null,
                  hint_tool_by_path: "sparkle_write_obsidian_by_path",
                  doc_url: "sparkle://docs/data-model#vault-items",
                }),
              },
            ],
          };
        }

        if (current.type !== "note") {
          return {
            content: [
              {
                type: "text",
                text: `Error: Item is a ${current.type}, not a note. Only notes can be advanced.`,
              },
            ],
            isError: true,
          };
        }

        const validTransitions: Record<string, string> = {
          developing: "fleeting",
          permanent: "developing",
        };
        const requiredStatus = validTransitions[target_status];
        if (current.status !== requiredStatus) {
          return {
            content: [
              {
                type: "text",
                text: `Error: Note is "${current.status}", but must be "${requiredStatus}" to advance to "${target_status}".`,
              },
            ],
            isError: true,
          };
        }

        const item = await updateItem(id, { status: target_status });
        const text = `Note advanced to "${target_status}" successfully.\n\n${formatItem(item)}`;
        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "sparkle_pause_note",
    {
      title: "Pause Sparkle Note",
      description: `Pause an items_active item (any type). Not applicable to vault items — returns \`VAULT_READONLY\`. paused is cross-type (orthogonal to status/type), cleared automatically on archive/export/done.

暫停的項目不會出現在 stale、attention 等提醒列表中，但可透過搜尋或暫停清單找到。可選填恢復備忘（下次回來時想記住什麼）。

Args:
  - id (string, required): Item UUID
  - context (string, optional): 恢復備忘（最多 500 字）

Returns: The updated item.`,
      inputSchema: z
        .object({
          id: z.string().uuid().describe("Item UUID"),
          context: z
            .string()
            .max(500)
            .optional()
            .describe("恢復備忘——下次回來時想記住什麼"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, context }) => {
      try {
        const current = await getItem(id);
        if ((current as { origin?: string }).origin === "vault") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  code: "VAULT_READONLY",
                  error: "此項目為 vault-origin，無法 pause（paused 欄位只存在於 items_active）",
                  error_en:
                    "Vault items have no paused field; pause_note does not apply. paused lives on items_active only.",
                }),
              },
            ],
            isError: true,
          };
        }
        const update: { paused: boolean; paused_context?: string } = { paused: true };
        if (context !== undefined) update.paused_context = context;
        const item = await updateItem(id, update);
        const text = `項目已暫停。\n\n${formatItem(item)}`;
        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "sparkle_resume_note",
    {
      title: "Resume Sparkle Note",
      description: `Resume a previously paused items_active item. Not applicable to vault items — returns \`VAULT_READONLY\`.

恢復後 stale 天數從現在起算。

Args:
  - id (string, required): Item UUID

Returns: The updated item.`,
      inputSchema: z
        .object({
          id: z.string().uuid().describe("Item UUID"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      try {
        // Fetch before resuming to capture paused_context (cleared on resume)
        const before = await getItem(id);
        if ((before as { origin?: string }).origin === "vault") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  code: "VAULT_READONLY",
                  error: "此項目為 vault-origin，無法 resume（paused 欄位只存在於 items_active）",
                  error_en:
                    "Vault items have no paused field; resume_note does not apply. paused lives on items_active only.",
                }),
              },
            ],
            isError: true,
          };
        }
        const item = await updateItem(id, { paused: false });
        let text = `項目已恢復。\n\n${formatItem(item)}`;
        if (before.paused_context) {
          text = `項目已恢復。\n\n**恢復備忘**: ${before.paused_context}\n\n${formatItem(item)}`;
        }
        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "sparkle_release_note",
    {
      title: "Release Vault Note from Sparkle",
      description: `Hard-delete an items_vault row. vault .md file is preserved; Sparkle simply stops tracking it. Irreversible: linked todos become dangling (they keep linked_note_id pointing at the released id, with linked_note_origin='missing' in API responses). Requires \`confirm=true\` for safety. Corresponds to REST endpoint \`DELETE /api/items/:id/vault-stub\`.

Args:
  - note_id (string, required): Vault item UUID
  - confirm (boolean, required): Must be true to proceed.

Returns: { ok: true, id, export_path } on success.`,
      inputSchema: z
        .object({
          note_id: z.string().uuid().describe("Vault item UUID"),
          confirm: z.boolean().describe("Must be true to proceed (safety guard)"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ note_id, confirm }) => {
      if (!confirm) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Refusing to release: confirm must be true. This is irreversible — Sparkle will stop tracking this note.",
            },
          ],
        };
      }
      try {
        const current = await getItem(note_id);
        if ((current as { origin?: string }).origin !== "vault") {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `Refusing to release: item ${note_id} is not a vault item (origin='${(current as { origin?: string }).origin ?? "unknown"}'). This tool only releases vault-origin items; to archive an active item use sparkle_update_note with status='archived'.`,
              },
            ],
          };
        }
        // else: vault-origin, proceed to release
        const result = await releaseVaultNote(note_id);
        return {
          content: [
            {
              type: "text",
              text: `已釋出 · vault 檔案保留。\nid: ${result.id}\nexport_path: ${result.export_path ?? "(unknown)"}`,
            },
          ],
        };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "sparkle_export_to_obsidian",
    {
      title: "Export Note to Obsidian",
      description: `Export a permanent note to the configured Obsidian vault as a .md file with YAML frontmatter.

Requirements:
  - Note must be type "note" with status "permanent"
  - Obsidian export must be configured in Sparkle settings

After export, the note's status changes to "exported".

Args:
  - id (string, required): Note UUID

Returns: The file path where the note was written in the Obsidian vault.`,
      inputSchema: z.object({
        id: z.string().uuid().describe("Note UUID"),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      try {
        const result = await exportToObsidian(id);
        return {
          content: [{ type: "text", text: `Note exported to Obsidian successfully.\n\nFile: ${result.path}` }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error exporting: ${(error as Error).message}. Make sure the note is "permanent" and Obsidian export is configured.` }],
          isError: true,
        };
      }
    },
  );
}
