import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Replace forbidden filename characters with '-', collapse consecutive dashes,
 * strip leading/trailing dashes and dots, truncate to 200 chars.
 */
export function sanitizeFilename(title: string): string {
  // Replace forbidden chars: /\:*?"<>|[]#^
  let name = title.replace(/[/\\:*?"<>|[\]#^]/g, "-");
  // Collapse consecutive dashes
  name = name.replace(/-{2,}/g, "-");
  // Strip leading dots and dashes
  name = name.replace(/^[.-]+/, "");
  // Strip trailing dashes
  name = name.replace(/-+$/, "");
  // Truncate to 200 characters
  if (name.length > 200) {
    name = name.slice(0, 200).replace(/-+$/, "");
  }
  return name || "untitled";
}

/**
 * Convert an ISO timestamp to local time without timezone suffix.
 * Input: "2026-02-25T06:00:00.000Z" → Output: "2026-02-25T14:00:00" (in local TZ)
 */
function toLocalDateTime(isoString: string): string {
  const d = new Date(isoString);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${mi}:${s}`;
}

/** Escape special chars for YAML double-quoted string content. */
function escapeYamlChars(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

const YAML_RESERVED = /^(true|false|yes|no|on|off|null|~)$/i;

/**
 * Escape a string for YAML output. Wraps in double quotes only when value
 * is empty, a YAML reserved word, or contains YAML-special characters.
 */
export function yamlEscape(value: string): string {
  if (value === "") return '""';
  if (YAML_RESERVED.test(value)) return `"${value}"`;
  const needsQuoting = /[\\:#{}"'[\]{},|>&!%@`\t\n\r]|^\s|\s$/;
  if (!needsQuoting.test(value)) return value;
  return `"${escapeYamlChars(value)}"`;
}

export interface ExportableItem {
  id: string;
  title: string;
  content: string | null;
  tags: string; // JSON array string
  aliases: string; // JSON array string
  source: string | null;
  created: string;
  modified: string;
  origin: string | null;
  priority: string | null;
  due: string | null;
  category_name: string | null;
}

/**
 * Generate YAML frontmatter for an exported item.
 * Fields are omitted when empty/null/default, except sparkle_id, created, modified, origin.
 */
export function generateFrontmatter(item: ExportableItem): string {
  const lines: string[] = ["---"];

  // Always present
  lines.push(`sparkle_id: "${item.id}"`);

  // Category — include when non-null
  if (item.category_name) {
    lines.push(`category: "${escapeYamlChars(item.category_name)}"`);
  }

  // Tags — include when non-empty
  let tags: string[] = [];
  try {
    tags = JSON.parse(item.tags);
  } catch {
    throw new Error(`Failed to parse tags JSON for item ${item.id}: ${item.tags}`);
  }
  if (tags.length > 0) {
    lines.push("tags:");
    for (const tag of tags) {
      lines.push(`  - ${yamlEscape(tag)}`);
    }
  }

  // Aliases — include when non-empty
  let aliases: string[] = [];
  try {
    aliases = JSON.parse(item.aliases);
  } catch {
    throw new Error(`Failed to parse aliases JSON for item ${item.id}: ${item.aliases}`);
  }
  if (aliases.length > 0) {
    lines.push("aliases:");
    for (const alias of aliases) {
      lines.push(`  - "${escapeYamlChars(alias)}"`);
    }
  }

  // Source — include when non-null
  if (item.source) {
    lines.push(`source: "${escapeYamlChars(item.source)}"`);
  }

  // Always present — local time, no TZ
  lines.push(`created: ${toLocalDateTime(item.created)}`);
  lines.push(`modified: ${toLocalDateTime(item.modified)}`);

  // Always present
  lines.push(`origin: ${yamlEscape(item.origin || "")}`);

  // Priority — include when non-null
  if (item.priority) {
    lines.push(`priority: ${item.priority}`);
  }

  // Due — include when non-null (already YYYY-MM-DD)
  if (item.due) {
    lines.push(`due: ${item.due}`);
  }

  lines.push("---");
  return lines.join("\n");
}

/**
 * Generate the full markdown content for an exported note.
 */
export function generateMarkdown(item: ExportableItem): string {
  const frontmatter = generateFrontmatter(item);
  const body = item.content || "";
  return `${frontmatter}\n\n# ${item.title}\n\n${body}\n`;
}

export type ExportMode = "new" | "overwrite";

export interface ExportConfig {
  vaultPath: string;
  inboxFolder: string;
  exportMode: ExportMode;
}

export interface ExportResult {
  path: string; // relative path within vault, e.g. "0_Inbox/Title.md"
}

/**
 * Write a .md file to the Obsidian vault.
 * Returns the relative path of the written file.
 */
export function exportToObsidian(item: ExportableItem, config: ExportConfig): ExportResult {
  const { vaultPath, inboxFolder, exportMode } = config;
  if (!vaultPath) {
    throw new Error("Obsidian vault path is not configured");
  }

  const targetDir = join(vaultPath, inboxFolder);

  // Ensure the target directory exists
  mkdirSync(targetDir, { recursive: true });

  const baseName = sanitizeFilename(item.title);
  let filename = `${baseName}.md`;
  const fullPath = join(targetDir, filename);

  if (exportMode === "new" || (exportMode === "overwrite" && !existsSync(fullPath))) {
    // Check for collision when creating new files
    if (existsSync(fullPath)) {
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
      filename = `${baseName} (${ts}).md`;
    }
  }
  // overwrite mode + file exists: just overwrite (no collision suffix needed)

  const finalPath = join(targetDir, filename);
  const content = generateMarkdown(item);
  writeFileSync(finalPath, content, "utf-8");

  return { path: `${inboxFolder}/${filename}` };
}
