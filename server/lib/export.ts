import { mkdir, writeFile, readdir, readFile, access } from "node:fs/promises";
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
 * Convert an ISO timestamp to local time with timezone offset.
 * Input: "2026-02-25T06:00:00.000Z" → Output: "2026-02-25T14:00:00+08:00" (in local TZ)
 */
function toLocalDateTime(isoString: string): string {
  const d = new Date(isoString);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const offsetMin = d.getTimezoneOffset();
  const sign = offsetMin <= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMin);
  const offsetH = String(Math.floor(absOffset / 60)).padStart(2, "0");
  const offsetM = String(absOffset % 60).padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${mi}:${s}${sign}${offsetH}:${offsetM}`;
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
  skipped?: boolean;
}

/**
 * Scan .md files in a directory for a matching sparkle_id in YAML frontmatter.
 * Returns the filename if found, null otherwise.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findExistingBySparkleId(dir: string, sparkleId: string): Promise<string | null> {
  if (!(await fileExists(dir))) return null;
  for (const file of await readdir(dir)) {
    if (!file.endsWith(".md")) continue;
    try {
      const content = await readFile(join(dir, file), "utf-8");
      // Quick check before parsing frontmatter
      if (!content.includes(sparkleId)) continue;
      // Check frontmatter for sparkle_id
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch?.[1]) continue;
      const sparkleIdMatch = fmMatch[1].match(/^sparkle_id:\s*"?([^"\n]+)"?/m);
      if (sparkleIdMatch?.[1] === sparkleId) {
        return file;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Write a .md file to the Obsidian vault.
 * Returns the relative path of the written file.
 */
export async function exportToObsidian(
  item: ExportableItem,
  config: ExportConfig,
): Promise<ExportResult> {
  const { vaultPath, inboxFolder, exportMode } = config;
  if (!vaultPath) {
    throw new Error("Obsidian vault path is not configured");
  }

  const targetDir = join(vaultPath, inboxFolder);

  // Ensure the target directory exists
  await mkdir(targetDir, { recursive: true });

  // Look for existing file with same sparkle_id
  const existingFile = await findExistingBySparkleId(targetDir, item.id);

  if (existingFile) {
    if (exportMode === "new") {
      return { path: `${inboxFolder}/${existingFile}`, skipped: true };
    }
    // overwrite mode: write to the existing file regardless of name
    const existingPath = join(targetDir, existingFile);
    const content = generateMarkdown(item);
    await writeFile(existingPath, content, "utf-8");
    return { path: `${inboxFolder}/${existingFile}` };
  }

  const baseName = sanitizeFilename(item.title);
  let filename = `${baseName}.md`;
  const fullPath = join(targetDir, filename);

  const fullPathExists = await fileExists(fullPath);
  if (exportMode === "new" || (exportMode === "overwrite" && !fullPathExists)) {
    // Check for collision when creating new files
    if (fullPathExists) {
      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      filename = `${baseName} (${ts}).md`;
    }
  }
  // overwrite mode + file exists: just overwrite (no collision suffix needed)

  const finalPath = join(targetDir, filename);
  const content = generateMarkdown(item);
  await writeFile(finalPath, content, "utf-8");

  return { path: `${inboxFolder}/${filename}` };
}
