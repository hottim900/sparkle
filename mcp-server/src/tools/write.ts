import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createItem, getItem, updateItem } from "../client.js";
import {
  blockToPayload,
  buildEditContext,
  renderItemWithEditContext,
  type EditContextPayload,
} from "../format.js";
import { formatToolError } from "../utils.js";
import { applyEdits, MAX_OPS, MAX_CONTENT_LENGTH } from "../edit/ops.js";
import { renderFailure } from "../edit/errors.js";
import { REVISION_REGEX } from "../edit/revision.js";
import { vaultReadonlyResponse } from "../lib/vault-readonly.js";
import { logger } from "../logger.js";

const HANDLE_REGEX = /^b\d+$/;

/** Exported so the M9 regression test can probe the production schema directly. */
export const editOpSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("replace_block"),
    handle: z
      .string()
      .regex(HANDLE_REGEX)
      .describe("Block handle from sparkle_get_note (e.g. 'b3'). Revision-scoped."),
    content: z.string().max(MAX_CONTENT_LENGTH).describe("Replacement markdown for the block"),
  }),
  z.object({
    kind: z.literal("replace_lines"),
    start_line: z.number().int().min(1).describe("First line to replace (1-indexed, inclusive)"),
    end_line: z.number().int().min(1).describe("Last line to replace (1-indexed, inclusive)"),
    content: z.string().max(MAX_CONTENT_LENGTH).describe("Replacement text for the line range"),
  }),
  z.object({
    kind: z.literal("replace_text"),
    old: z
      .string()
      .min(1)
      .max(MAX_CONTENT_LENGTH)
      .describe(
        "Text to find (Tier 1: byte-exact; Tier 2: CJK ↔ ASCII punctuation fold if Tier 1 fails)",
      ),
    new: z.string().max(MAX_CONTENT_LENGTH).describe("Replacement text (empty string deletes the match)"),
  }),
  z.object({
    kind: z.literal("delete_block"),
    handle: z.string().regex(HANDLE_REGEX).describe("Block handle from sparkle_get_note"),
  }),
  z.object({
    kind: z.literal("delete_lines"),
    start_line: z.number().int().min(1).describe("First line to delete (1-indexed, inclusive)"),
    end_line: z.number().int().min(1).describe("Last line to delete (1-indexed, inclusive)"),
  }),
  z.object({
    kind: z.literal("insert_after_line"),
    line: z
      .number()
      .int()
      .min(0)
      .describe("Line to insert after (1-indexed). Use line=0 to prepend at the top of the note."),
    content: z.string().max(MAX_CONTENT_LENGTH).describe("Text to insert"),
  }),
]);

export function registerWriteTools(server: McpServer): void {
  server.registerTool(
    "sparkle_create_note",
    {
      title: "Create Sparkle Note",
      description: `Create a new note, todo, or scratch item in Sparkle. Default type is "note" with status "fleeting". Use type "todo" for tasks (status defaults to "active"). Use type "scratch" for disposable temporary notes (status defaults to "draft").

Response includes the created item plus an \`edit-context\` block (revision + lines + blocks) so you can chain a sparkle_edit_note call without an extra sparkle_get_note round-trip.

Args:
  - title (string, required): Note title (1-500 chars)
  - content (string, optional): Note content in markdown
  - tags (string[], optional): Tags to apply (max 20, each max 50 chars)
  - status (string, optional): Initial status — "fleeting" (default), "developing", "permanent", "active" (todo), or "draft" (scratch)
  - type (string, optional): Item type — "note" (default), "todo", or "scratch"
  - priority (string, optional): Priority level — "high", "medium", or "low" (todo only)
  - due (string, optional): Due date in YYYY-MM-DD format (todo only)
  - source (string, optional): Reference URL
  - aliases (string[], optional): Alternative names for Obsidian linking
  - linked_note_id (string, optional): UUID of a note to link this todo to (todo only)
  - category_id (string, optional): Category UUID to assign (null to clear)
  - is_private (boolean, optional): Mark as private note, hidden from default views (default: false)

Returns: The created item with all fields including generated ID and timestamps.`,
      inputSchema: z
        .object({
          title: z.string().min(1).max(500).describe("Note title"),
          content: z.string().max(MAX_CONTENT_LENGTH).optional().describe("Note content (markdown)"),
          tags: z.array(z.string().min(1).max(50)).max(20).optional().describe("Tags"),
          status: z
            .enum(["fleeting", "developing", "permanent", "active", "draft"])
            .optional()
            .describe("Initial status (default: fleeting)"),
          type: z
            .enum(["note", "todo", "scratch"])
            .optional()
            .describe("Item type (default: note)"),
          priority: z
            .enum(["high", "medium", "low"])
            .optional()
            .describe("Priority level (todo only)"),
          due: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe("Due date YYYY-MM-DD (todo only)"),
          source: z.string().max(2000).optional().describe("Reference URL"),
          aliases: z.array(z.string().min(1).max(200)).max(10).optional().describe("Alternative names"),
          linked_note_id: z.string().uuid().optional().describe("UUID of linked note (todo only)"),
          category_id: z
            .string()
            .uuid()
            .nullable()
            .optional()
            .describe("Category UUID to assign (null to clear)"),
          is_private: z
            .boolean()
            .optional()
            .describe("標記為私密筆記 (default: false)"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      title,
      content,
      tags,
      status,
      type,
      priority,
      due,
      source,
      aliases,
      linked_note_id,
      category_id,
      is_private,
    }) => {
      try {
        const item = await createItem({
          title,
          type: type ?? "note",
          content: content ?? "",
          tags,
          status,
          priority: priority ?? null,
          due: due ?? null,
          source: source ?? null,
          aliases,
          linked_note_id: linked_note_id ?? null,
          category_id: category_id ?? null,
          is_private,
        });
        const ctx = buildEditContext(item.content, item.origin);
        const text = `Note created successfully.\n\n${renderItemWithEditContext(item, ctx)}`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "sparkle_update_note",
    {
      title: "Update Sparkle Note metadata",
      description: `Update an items_active row's metadata (title, tags, status, type, priority, due, aliases, source, linked_note_id, category_id, is_private, paused). Vault-origin items return \`VAULT_READONLY\` (409 Conflict).

**Content editing moved to sparkle_edit_note in v2.** This tool no longer accepts \`content\` or \`old_content\`. To edit a note's body:
  1. Call \`sparkle_get_note(id)\` and read the \`revision\` from the edit-context block.
  2. Call \`sparkle_edit_note(id, revision, ops)\` with one or more edit ops (replace_block / replace_lines / replace_text / delete_block / delete_lines / insert_after_line).

Updating metadata via this tool does not bump the content revision.

Args:
  - id (string, required): Item UUID
  - title (string, optional): New title
  - tags (string[], optional): New tags (replaces all existing tags)
  - status (string, optional): New status
  - type (string, optional): Change item type (note/todo/scratch). Status auto-maps on type change.
  - priority (string, optional): Priority level — "high", "medium", "low", or null to clear (todo only)
  - due (string, optional): Due date YYYY-MM-DD, or null to clear (todo only)
  - aliases (string[], optional): New aliases (replaces all existing aliases)
  - source (string, optional): Reference URL (set to null to clear)
  - linked_note_id (string, optional): UUID of linked note, or null to clear (todo only)
  - category_id (string, optional): Category UUID to assign, or null to clear
  - is_private (boolean, optional): Mark item as private (true only; already-private items return 404 from normal API)
  - paused (boolean, optional): 暫停/恢復項目。暫停的項目不會出現在 stale、attention 等提醒列表中。
  - paused_context (string, optional): 恢復備忘（最多 500 字）——下次回來時想記住什麼。僅在 paused=true 時有效。

Returns: The updated item with all fields.

Side effects:
  - Type change to note: clears linked_note_id and due (not supported on notes).
  - Type change to scratch: clears tags, priority, due, aliases, linked_note_id (scratch only keeps title + content). category_id is preserved.`,
      inputSchema: z
        .object({
          id: z.string().uuid().describe("Item UUID"),
          title: z.string().min(1).max(500).optional().describe("New title"),
          tags: z.array(z.string().min(1).max(50)).max(20).optional().describe("New tags (replaces all)"),
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
            .describe("New status"),
          type: z
            .enum(["note", "todo", "scratch"])
            .optional()
            .describe("Change item type (status auto-maps)"),
          priority: z
            .enum(["high", "medium", "low"])
            .nullable()
            .optional()
            .describe("Priority (todo only, null to clear)"),
          due: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable()
            .optional()
            .describe("Due date YYYY-MM-DD (todo only, null to clear)"),
          aliases: z
            .array(z.string().min(1).max(200))
            .max(10)
            .optional()
            .describe("New aliases (replaces all)"),
          source: z
            .string()
            .max(2000)
            .nullable()
            .optional()
            .describe("Reference URL (null to clear)"),
          linked_note_id: z
            .string()
            .uuid()
            .nullable()
            .optional()
            .describe("Linked note UUID (todo only, null to clear)"),
          category_id: z
            .string()
            .uuid()
            .nullable()
            .optional()
            .describe("Category UUID (null to clear)"),
          is_private: z
            .boolean()
            .optional()
            .describe("標記為私密筆記 (true to mark as private)"),
          paused: z
            .boolean()
            .optional()
            .describe("暫停/恢復項目"),
          paused_context: z
            .string()
            .max(500)
            .optional()
            .describe("恢復備忘——下次回來時想記住什麼（僅 paused=true 時有效）"),
          // V2 cutover: catch legacy content fields explicitly so the LLM gets
          // a pointer to sparkle_edit_note instead of a generic zod
          // "unrecognized key" error. (Per design DX-D4.)
          content: z
            .never({
              error:
                "RETIRED in v2: content editing moved to sparkle_edit_note. Call sparkle_get_note to obtain `revision`, then use sparkle_edit_note with ops[].",
            })
            .optional(),
          old_content: z
            .never({
              error:
                "RETIRED in v2: old_content/content find-and-replace moved to sparkle_edit_note (kind: 'replace_text'). See sparkle_edit_note tool description for the v2 op shape.",
            })
            .optional(),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      id,
      title,
      tags,
      status,
      type,
      priority,
      due,
      aliases,
      source,
      linked_note_id,
      category_id,
      is_private,
      paused,
      paused_context,
    }) => {
      try {
        const update: Record<string, unknown> = {};
        if (title !== undefined) update.title = title;
        if (tags !== undefined) update.tags = tags;
        if (status !== undefined) update.status = status;
        if (type !== undefined) update.type = type;
        if (priority !== undefined) update.priority = priority;
        if (due !== undefined) update.due = due;
        if (aliases !== undefined) update.aliases = aliases;
        if (source !== undefined) update.source = source;
        if (linked_note_id !== undefined) update.linked_note_id = linked_note_id;
        if (category_id !== undefined) update.category_id = category_id;
        if (is_private !== undefined) update.is_private = is_private;
        if (paused !== undefined) update.paused = paused;
        if (paused_context !== undefined) update.paused_context = paused_context;

        const item = await updateItem(id, update);
        const text = `Note metadata updated successfully.\n\nID: ${item.id} | Title: ${item.title} | Status: ${item.status}`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "sparkle_edit_note",
    {
      title: "Edit Sparkle Note content (v2 atomic ops)",
      description: `Apply atomic edit ops to an items_active row's content. Pin every call against a \`revision\` obtained from sparkle_get_note (or any prior sparkle_create_note / sparkle_edit_note success response). Vault-origin items return VAULT_READONLY — use sparkle_write_obsidian instead.

**Magical moment**: one sparkle_edit_note call performs multiple atomic edits — restructuring no longer takes 5 round-trips.

Six op kinds (atomic — all succeed or none apply):
  - \`replace_block(handle, content)\` — swap a paragraph/heading/list/table/code-block by opaque handle (preferred — unambiguous addressing)
  - \`replace_lines(start_line, end_line, content)\` — rewrite an inclusive line range (use for cross-block restructuring)
  - \`replace_text(old, new)\` — Tier 1 byte-exact; if zero matches, Tier 2 retries with CJK ↔ ASCII punctuation fold (：→: ；→; （→( ）→) ，→, 。→. ！→! ？→? 、→,). Code blocks (fenced + inline) excluded from Tier 2.
  - \`delete_block(handle)\` — remove a block
  - \`delete_lines(start_line, end_line)\` — remove a line range
  - \`insert_after_line(line, content)\` — \`line=0\` means prepend at top

**Op-choice safety ranking**: \`replace_block\` > \`replace_lines\` > \`replace_text\`. Block and line ops have unambiguous addressing — use \`replace_text\` for typo-class edits or punctuation drift only.

| Edit shape                                          | Use                  |
|-----------------------------------------------------|----------------------|
| Whole paragraph / heading / list / table            | \`replace_block\`      |
| Cross-block restructuring                           | \`replace_lines\`      |
| Intra-paragraph small edit / punctuation drift      | \`replace_text\`       |
| Add new content                                     | \`insert_after_line\`  |

**Handles are revision-scoped — discard the old ones after every successful edit.** The response gives you a fresh \`revision\` + new \`blocks\`; use those next time. Reusing the OLD revision after an edit returns REVISION_MISMATCH (recoverable). Reusing an OLD handle with the NEW revision is worse — the handle (e.g., \`b3\`) may resolve to a *different* block than you intended, silently editing the wrong content. Always pair each call's handles with the revision they came from.

Args:
  - \`id\` (string, required): Item UUID
  - \`revision\` (string, required): sha256 hex from edit-context (lowercase, 64 chars)
  - \`ops\` (EditOp[], required): 1–${MAX_OPS} ops, discriminated by \`kind\`

Errors:
  - VAULT_READONLY: item is vault-origin; use sparkle_write_obsidian
  - REVISION_MISMATCH: content changed since you fetched it; payload includes fresh revision/lines/blocks for retargeting
  - NO_MATCH: replace_text exhausted Tier 1 + Tier 2; payload includes closest_match + diff
  - AMBIGUOUS_MATCH: more than one location matches; payload includes line locations
  - INVALID_HANDLE: block handle not in current revision; payload lists valid_handles
  - INVALID_RANGE: line range out of bounds (line=0 only valid for insert_after_line)
  - EMPTY_OPS / TOO_MANY_OPS / OVERLAPPING_OPS / DUPLICATE_OPS
  - CONTENT_TOO_LARGE: post-edit content > ${MAX_CONTENT_LENGTH} chars; payload lists delta_per_op
  - PARSE_ERROR: markdown parser failed; use replace_lines (no parse needed) or fix the note manually

Returns: updated item + fresh revision + fresh lines + fresh blocks + match_tiers (per-op, null for non-replace_text ops).`,
      inputSchema: z
        .object({
          id: z.string().uuid().describe("Item UUID"),
          revision: z
            .string()
            .regex(REVISION_REGEX)
            .describe("sha256 hex of the content snapshot you read (lowercase, 64 chars)"),
          ops: z
            .array(editOpSchema)
            .min(1)
            .max(MAX_OPS)
            .describe(`1-${MAX_OPS} edit ops; discriminated by "kind"`),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ id, revision, ops }) => {
      try {
        const current = await getItem(id);
        if (current.origin === "vault") {
          return vaultReadonlyResponse(
            current.id,
            "此項目為 vault-origin，無法以 sparkle_edit_note 編輯內容（vault .md 是 source of truth）",
            "Vault-origin items are read-only via sparkle_edit_note; the vault .md is the content source of truth.",
          );
        }

        const result = applyEdits({
          content: current.content,
          expectedRevision: revision,
          ops,
        });
        if (!result.ok) {
          return {
            content: [{ type: "text", text: renderFailure(result.failure) }],
            isError: true,
          };
        }

        const updated = await updateItem(id, { content: result.newContent });
        const ctx: EditContextPayload = {
          revision: result.newRevision,
          lines: result.newLines,
          blocks: result.newBlocks.map(blockToPayload),
          match_tiers: result.matchTiers.map(t => t ?? null),
        };
        for (const tier of result.matchTiers) {
          if (tier) logger.info({ id, match_tier: tier }, "sparkle_edit_note replace_text resolved");
        }
        const text = `Note edited successfully.\n\n${renderItemWithEditContext(updated, ctx)}`;
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );
}
