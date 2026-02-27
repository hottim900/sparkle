import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createItem, getItem, updateItem } from "../client.js";
import { formatItem } from "../format.js";

export function registerWriteTools(server: McpServer): void {
  server.registerTool(
    "sparkle_create_note",
    {
      title: "Create Sparkle Note",
      description: `Create a new note, todo, or scratch item in Sparkle. Default type is "note" with status "fleeting". Use type "todo" for tasks (status defaults to "active"). Use type "scratch" for disposable temporary notes (status defaults to "draft").

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

Returns: The created item with all fields including generated ID and timestamps.`,
      inputSchema: {
        title: z.string().min(1).max(500).describe("Note title"),
        content: z.string().max(50000).optional().describe("Note content (markdown)"),
        tags: z.array(z.string().max(50)).max(20).optional().describe("Tags"),
        status: z.enum(["fleeting", "developing", "permanent", "active", "draft"]).optional().describe("Initial status (default: fleeting)"),
        type: z.enum(["note", "todo", "scratch"]).optional().describe("Item type (default: note)"),
        priority: z.enum(["high", "medium", "low"]).optional().describe("Priority level (todo only)"),
        due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Due date YYYY-MM-DD (todo only)"),
        source: z.string().max(2000).optional().describe("Reference URL"),
        aliases: z.array(z.string().max(200)).max(10).optional().describe("Alternative names"),
        linked_note_id: z.string().uuid().optional().describe("UUID of linked note (todo only)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ title, content, tags, status, type, priority, due, source, aliases, linked_note_id }) => {
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
        });
        const text = `Note created successfully.\n\n${formatItem(item)}`;
        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error creating note: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "sparkle_update_note",
    {
      title: "Update Sparkle Note",
      description: `Update an existing item's content, title, tags, status, type, or other fields. Only provided fields are updated; omitted fields remain unchanged.

Args:
  - id (string, required): Item UUID
  - title (string, optional): New title
  - content (string, optional): New content (markdown). Replaces entire content field.
  - old_content (string, optional): When provided together with content, performs find-and-replace: old_content is matched against the existing note content and replaced with content. Exactly one match required — zero matches returns NO_MATCH error, multiple matches returns AMBIGUOUS_MATCH error. Omit old_content to replace the entire content field.
  - tags (string[], optional): New tags (replaces all existing tags)
  - status (string, optional): New status
  - type (string, optional): Change item type (note/todo/scratch). Status auto-maps on type change.
  - priority (string, optional): Priority level — "high", "medium", "low", or null to clear (todo only)
  - due (string, optional): Due date YYYY-MM-DD, or null to clear (todo only)
  - aliases (string[], optional): New aliases (replaces all existing aliases)
  - source (string, optional): Reference URL (set to null to clear)
  - linked_note_id (string, optional): UUID of linked note, or null to clear (todo only)

Returns: The updated item with all fields.

Content editing modes:
  - Full replace: provide only content — replaces the entire content field.
  - Partial edit: provide both old_content and content — finds old_content in the note and replaces it with content. Always use sparkle_get_note first to get the exact text for old_content. Set content to empty string to delete the matched section.`,
      inputSchema: {
        id: z.string().uuid().describe("Item UUID"),
        title: z.string().min(1).max(500).optional().describe("New title"),
        content: z.string().max(50000).optional().describe("New content (replaces existing)"),
        old_content: z.string().min(1).max(50000).optional().describe("Find-and-replace: text to find in existing content (use with content)"),
        tags: z.array(z.string().max(50)).max(20).optional().describe("New tags (replaces all)"),
        status: z.enum(["fleeting", "developing", "permanent", "exported", "active", "done", "draft", "archived"]).optional().describe("New status"),
        type: z.enum(["note", "todo", "scratch"]).optional().describe("Change item type (status auto-maps)"),
        priority: z.enum(["high", "medium", "low"]).nullable().optional().describe("Priority (todo only, null to clear)"),
        due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().describe("Due date YYYY-MM-DD (todo only, null to clear)"),
        aliases: z.array(z.string().max(200)).max(10).optional().describe("New aliases (replaces all)"),
        source: z.string().max(2000).nullable().optional().describe("Reference URL (null to clear)"),
        linked_note_id: z.string().uuid().nullable().optional().describe("Linked note UUID (todo only, null to clear)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, title, content, old_content, tags, status, type, priority, due, aliases, source, linked_note_id }) => {
      try {
        // Find-and-replace mode: old_content + content
        if (old_content !== undefined && content === undefined) {
          return {
            content: [{ type: "text", text: "Error: content is required when old_content is provided." }],
            isError: true,
          };
        }

        let resolvedContent = content;
        if (old_content !== undefined && content !== undefined) {
          const current = await getItem(id);
          const matchCount = current.content.split(old_content).length - 1;
          if (matchCount === 0) {
            const preview = current.content.slice(0, 200);
            return {
              content: [{ type: "text", text: `NO_MATCH: The specified old_content was not found in the note.\nCurrent content (first 200 chars): ${preview}` }],
              isError: true,
            };
          }
          if (matchCount > 1) {
            return {
              content: [{ type: "text", text: `AMBIGUOUS_MATCH: old_content was found ${matchCount} times. Provide more surrounding context to uniquely identify the section to replace.` }],
              isError: true,
            };
          }
          resolvedContent = current.content.replace(old_content, content);
        }

        const update: Record<string, unknown> = {};
        if (title !== undefined) update.title = title;
        if (resolvedContent !== undefined) update.content = resolvedContent;
        if (tags !== undefined) update.tags = tags;
        if (status !== undefined) update.status = status;
        if (type !== undefined) update.type = type;
        if (priority !== undefined) update.priority = priority;
        if (due !== undefined) update.due = due;
        if (aliases !== undefined) update.aliases = aliases;
        if (source !== undefined) update.source = source;
        if (linked_note_id !== undefined) update.linked_note_id = linked_note_id;

        const item = await updateItem(id, update);
        const text = `Note updated successfully.\n\n${formatItem(item)}`;
        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error updating note: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
