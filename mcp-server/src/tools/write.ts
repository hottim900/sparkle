import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createItem, updateItem } from "../client.js";
import { formatItem } from "../format.js";

export function registerWriteTools(server: McpServer): void {
  server.registerTool(
    "sparkle_create_note",
    {
      title: "Create Sparkle Note",
      description: `Create a new note or scratch item in Sparkle. Default type is "note" with status "fleeting". Use type "scratch" for disposable temporary notes (status defaults to "draft").

Args:
  - title (string, required): Note title (1-500 chars)
  - content (string, optional): Note content in markdown
  - tags (string[], optional): Tags to apply (max 20, each max 50 chars)
  - status (string, optional): Initial status — "fleeting" (default), "developing", "permanent", or "draft" (scratch only)
  - type (string, optional): Item type — "note" (default) or "scratch"
  - source (string, optional): Reference URL
  - aliases (string[], optional): Alternative names for Obsidian linking

Returns: The created note with all fields including generated ID and timestamps.`,
      inputSchema: {
        title: z.string().min(1).max(500).describe("Note title"),
        content: z.string().max(50000).optional().describe("Note content (markdown)"),
        tags: z.array(z.string().max(50)).max(20).optional().describe("Tags"),
        status: z.enum(["fleeting", "developing", "permanent", "draft"]).optional().describe("Initial status (default: fleeting)"),
        type: z.enum(["note", "scratch"]).optional().describe("Item type (default: note)"),
        source: z.string().max(2000).optional().describe("Reference URL"),
        aliases: z.array(z.string().max(200)).max(10).optional().describe("Alternative names"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ title, content, tags, status, type, source, aliases }) => {
      try {
        const item = await createItem({
          title,
          type: type ?? "note",
          content: content ?? "",
          tags,
          status,
          source: source ?? null,
          aliases,
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
      description: `Update an existing note's content, title, tags, status, or aliases. Only provided fields are updated; omitted fields remain unchanged.

Args:
  - id (string, required): Item UUID
  - title (string, optional): New title
  - content (string, optional): New content (markdown). Replaces entire content field.
  - tags (string[], optional): New tags (replaces all existing tags)
  - status (string, optional): New status
  - aliases (string[], optional): New aliases (replaces all existing aliases)
  - source (string, optional): Reference URL (set to null to clear)

Returns: The updated note with all fields.

Note: To append content, first read the note with sparkle_get_note, then update with the combined content.`,
      inputSchema: {
        id: z.string().uuid().describe("Item UUID"),
        title: z.string().min(1).max(500).optional().describe("New title"),
        content: z.string().max(50000).optional().describe("New content (replaces existing)"),
        tags: z.array(z.string().max(50)).max(20).optional().describe("New tags (replaces all)"),
        status: z.enum(["fleeting", "developing", "permanent", "exported", "active", "done", "draft", "archived"]).optional().describe("New status"),
        aliases: z.array(z.string().max(200)).max(10).optional().describe("New aliases (replaces all)"),
        source: z.string().max(2000).nullable().optional().describe("Reference URL (null to clear)"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, title, content, tags, status, aliases, source }) => {
      try {
        const update: Record<string, unknown> = {};
        if (title !== undefined) update.title = title;
        if (content !== undefined) update.content = content;
        if (tags !== undefined) update.tags = tags;
        if (status !== undefined) update.status = status;
        if (aliases !== undefined) update.aliases = aliases;
        if (source !== undefined) update.source = source;

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
