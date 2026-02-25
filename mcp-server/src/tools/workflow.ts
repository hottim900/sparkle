import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getItem, updateItem, exportToObsidian } from "../client.js";
import { formatItem } from "../format.js";

export function registerWorkflowTools(server: McpServer): void {
  server.registerTool(
    "sparkle_advance_note",
    {
      title: "Advance Note Maturity",
      description: `Advance a note's maturity stage in the Zettelkasten flow.

Valid progressions:
  - fleeting → developing (note has been expanded with initial thoughts)
  - developing → permanent (note is well-developed and complete)

The note must be type "note" and in the correct current status for the target.

Args:
  - id (string, required): Note UUID
  - target_status (string, required): "developing" or "permanent"

Returns: The updated note.`,
      inputSchema: {
        id: z.string().uuid().describe("Note UUID"),
        target_status: z.enum(["developing", "permanent"]).describe("Target maturity status"),
      },
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
        if (current.type !== "note") {
          return {
            content: [{ type: "text", text: `Error: Item is a ${current.type}, not a note. Only notes can be advanced.` }],
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
            content: [{ type: "text", text: `Error: Note is "${current.status}", but must be "${requiredStatus}" to advance to "${target_status}".` }],
            isError: true,
          };
        }

        const item = await updateItem(id, { status: target_status });
        const text = `Note advanced to "${target_status}" successfully.\n\n${formatItem(item)}`;
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
      inputSchema: {
        id: z.string().uuid().describe("Note UUID"),
      },
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
