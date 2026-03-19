import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  readVaultFileBySparkleId,
  readVaultFileByPath,
  writeVaultFileBySparkleId,
  writeVaultFileByPath,
} from "../vault.js";
import type { VaultFile } from "../types.js";

function formatVaultFile(file: VaultFile): string {
  const lines: string[] = [`**Path:** ${file.path}`];

  // Frontmatter summary
  const fm = file.frontmatter;
  if (fm.sparkle_id) lines.push(`**Sparkle ID:** ${fm.sparkle_id}`);
  if (fm.tags && Array.isArray(fm.tags) && fm.tags.length > 0) {
    lines.push(`**Tags:** ${fm.tags.join(", ")}`);
  }
  if (fm.category) lines.push(`**Category:** ${fm.category}`);
  if (fm.created) lines.push(`**Created:** ${fm.created}`);
  if (fm.modified) lines.push(`**Modified:** ${fm.modified}`);

  lines.push("", "---", "", file.body);
  return lines.join("\n");
}

export function registerVaultTools(server: McpServer): void {
  server.registerTool(
    "sparkle_read_obsidian",
    {
      title: "Read Vault File by Sparkle ID",
      description: `Read an exported note from the Obsidian vault using its sparkle_id (written in YAML frontmatter during export).

Use this to read back notes that were exported via sparkle_export_to_obsidian. The file is located by scanning vault .md files for matching sparkle_id frontmatter, regardless of file path or name changes in Obsidian.

Args:
  - sparkle_id (string): The Sparkle note UUID

Returns: File path, frontmatter summary, and full body content.
Requires Obsidian integration to be enabled in Sparkle settings.`,
      inputSchema: {
        sparkle_id: z.string().uuid().describe("Sparkle note UUID"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sparkle_id }) => {
      try {
        const file = await readVaultFileBySparkleId(sparkle_id);
        return {
          content: [{ type: "text", text: formatVaultFile(file) }],
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
    "sparkle_write_obsidian",
    {
      title: "Write Vault File by Sparkle ID",
      description: `Update an exported note in the Obsidian vault using its sparkle_id.

Locates the file by sparkle_id frontmatter and replaces its entire content. Use sparkle_read_obsidian first to get the current content, then modify and write back.

For correct Obsidian Markdown formatting (wikilinks, callouts, etc.), follow obsidian-skills conventions.

Args:
  - sparkle_id (string): The Sparkle note UUID
  - content (string): Full file content to write (including frontmatter)

Returns: Confirmation with file path.`,
      inputSchema: {
        sparkle_id: z.string().uuid().describe("Sparkle note UUID"),
        content: z.string().min(1).describe("Full file content to write"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ sparkle_id, content }) => {
      try {
        const path = await writeVaultFileBySparkleId(sparkle_id, content);
        return {
          content: [{ type: "text", text: `File updated successfully.\n\n**Path:** ${path}` }],
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
    "sparkle_read_obsidian_by_path",
    {
      title: "Read Vault File by Path",
      description: `Read any .md file from the Obsidian vault by its relative path.

Use this to access vault files that were not exported from Sparkle (no sparkle_id), or when you know the exact path.

Args:
  - path (string): Relative path from vault root (e.g. "Projects/my-note.md")

Returns: File path, frontmatter summary (if any), and full body content.`,
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe("Relative path from vault root (e.g. 'folder/note.md')"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ path }) => {
      try {
        const file = await readVaultFileByPath(path);
        return {
          content: [{ type: "text", text: formatVaultFile(file) }],
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
    "sparkle_write_obsidian_by_path",
    {
      title: "Write Vault File by Path",
      description: `Write or create a .md file in the Obsidian vault by relative path.

Creates parent directories if they don't exist. If the file already exists, it will be overwritten.

For correct Obsidian Markdown formatting (wikilinks, callouts, frontmatter), follow obsidian-skills conventions.

Args:
  - path (string): Relative path from vault root, must end with .md
  - content (string): Full file content to write

Returns: Confirmation with file path.`,
      inputSchema: {
        path: z
          .string()
          .min(1)
          .regex(/\.md$/, "Path must end with .md")
          .describe("Relative path from vault root, must end with .md"),
        content: z.string().min(1).describe("Full file content to write"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ path, content }) => {
      try {
        const resultPath = await writeVaultFileByPath(path, content);
        return {
          content: [
            { type: "text", text: `File written successfully.\n\n**Path:** ${resultPath}` },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
