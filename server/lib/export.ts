import { mkdir, writeFile, access, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { getVaultPathBySparkleIdSync } from "./items.js";

/**
 * Thrown when export sees vault_files already carries this sparkle_id (= a
 * prior export wrote the .md but the items_vault transition aborted). User
 * resolves via `npm run vault:reconcile` (interactive: re-promote, delete .md,
 * or skip). Surfaced as 500 with an actionable message.
 */
export class ExportCrashRecoveryError extends Error {
  readonly code = "EXPORT_CRASH_RECOVERY" as const;
  constructor(
    public readonly sparkleId: string,
    public readonly vaultPath: string,
  ) {
    super(
      `上次 export 未完成 — vault_files 已記錄 ${sparkleId}，但 items_vault 缺對應 row。請執行 \`npm run vault:reconcile\` 解決後再試。`,
    );
    this.name = "ExportCrashRecoveryError";
  }
}

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

/**
 * Normalize tags for Obsidian export: lowercase, spaces→hyphens, deduplicate.
 * Preserves first occurrence when normalization creates duplicates.
 */
export function normalizeTags(tags: string[]): string[] {
  const normalized = tags.map((t) => t.toLowerCase().replace(/\s+/g, "-"));
  return [...new Set(normalized)];
}

export type ItemLookup = (shortId: string) => { title: string } | null;

/**
 * Replace Sparkle ID references in content with Obsidian wikilinks.
 * Pattern: 筆記（xxxxxxxx）where xxxxxxxx is 4-8 hex chars.
 * Preserves original text when lookup fails or is ambiguous.
 */
export function resolveSparkleReferences(content: string, lookupItem: ItemLookup): string {
  return content.replace(/筆記（([a-f0-9]{4,8})）/g, (match, shortId) => {
    try {
      const item = lookupItem(shortId);
      if (!item) return match;
      // Sanitize title for Obsidian wikilink: ]] breaks link, [[ nests, | is alias separator
      const safeTitle = item.title
        .replace(/\|/g, "-")
        .replace(/\]\]/g, "）")
        .replace(/\[\[/g, "（")
        .replace(/\n/g, " ");
      return `[[${safeTitle}]]`;
    } catch {
      return match;
    }
  });
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
}

/**
 * Generate YAML frontmatter for an exported item.
 * Fields are omitted when empty/null/default, except sparkle_id, created, modified, origin.
 */
export function generateFrontmatter(item: ExportableItem): string {
  const lines: string[] = ["---"];

  // Always present
  lines.push(`sparkle_id: "${item.id}"`);

  // Tags — include when non-empty, normalized for Obsidian
  let tags: string[] = [];
  try {
    tags = JSON.parse(item.tags);
  } catch {
    throw new Error(`Failed to parse tags JSON for item ${item.id}: ${item.tags}`);
  }
  const normalizedTags = normalizeTags(tags);
  if (normalizedTags.length > 0) {
    lines.push("tags:");
    for (const tag of normalizedTags) {
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
  const hasH1 = /^#\s/.test(body.trimStart());
  const titleBlock = hasH1 ? "" : `# ${item.title}\n\n`;
  return `${frontmatter}\n\n${titleBlock}${body}\n`;
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
  /**
   * Bytes/metadata of the freshly-written .md, supplied to commitExportToVault
   * so vault_files is seeded inside the same transaction (eliminates the
   * 5-minute reverse-lookup blackout right after export). Absent when
   * `skipped: true`.
   */
  diskBytes?: {
    content: string;
    mtime: number;
    contentHash: string;
    frontmatter: string | null;
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * After writing to disk, gather the bytes/metadata that vault_files needs.
 * Mirrors what vault-scanner.ts captures during its 5-min cycles so the seeded
 * row is interchangeable with a scanner-discovered row (next scan: mtime
 * matches → skip re-read).
 */
async function collectDiskBytes(
  fullPath: string,
  content: string,
): Promise<{ content: string; mtime: number; contentHash: string; frontmatter: string | null }> {
  const fileStat = await stat(fullPath);
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return {
    content,
    mtime: Math.floor(fileStat.mtimeMs),
    contentHash: createHash("sha256").update(content, "utf-8").digest("hex"),
    frontmatter: fmMatch?.[1]?.replace(/\r$/gm, "") ?? null,
  };
}

/**
 * Write a .md file to the Obsidian vault. Pre-flights against vault_files to
 * detect the export-crash recovery window (disk-then-DB ordering means a DB
 * failure can leave a .md on disk indexed by the scanner without an
 * items_vault row).
 *
 * Caller is the export route in routes/items.ts (always passes sqlite). Tests
 * may pass a fake sqlite that returns no match.
 *
 * Returns the relative path of the written file.
 */
export async function exportToObsidian(
  item: ExportableItem,
  config: ExportConfig,
  sqlite?: Database.Database,
): Promise<ExportResult> {
  const { vaultPath, inboxFolder, exportMode } = config;
  if (!vaultPath) {
    throw new Error("Obsidian vault path is not configured");
  }

  const targetDir = join(vaultPath, inboxFolder);

  // Ensure the target directory exists
  await mkdir(targetDir, { recursive: true });

  // Crash-recovery pre-check. vault_files row exists but items_vault doesn't
  // == prior export's items_vault INSERT failed mid-tx. Force operator through
  // vault:reconcile rather than silently overwriting + retrying.
  // sqlite is optional so unit tests of the file-writing logic don't have to
  // build a full DB; production routes always pass it.
  const indexedPath = sqlite ? getVaultPathBySparkleIdSync(sqlite, item.id) : null;
  if (sqlite && indexedPath) {
    const itemsVaultExists = sqlite.prepare("SELECT 1 FROM items_vault WHERE id = ?").get(item.id);
    if (!itemsVaultExists) {
      throw new ExportCrashRecoveryError(item.id, indexedPath);
    }
    // Both rows present → user is re-exporting an already-vault item, which
    // the export route already 409s on (origin === 'vault'). Reaching here
    // would be unexpected; treat as overwrite-of-existing for safety.
    if (exportMode === "new") {
      return { path: indexedPath, skipped: true };
    }
    const fullPath = join(vaultPath, indexedPath);
    const content = generateMarkdown(item);
    await writeFile(fullPath, content, "utf-8");
    const diskBytes = await collectDiskBytes(fullPath, content);
    return { path: indexedPath, diskBytes };
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
  const diskBytes = await collectDiskBytes(finalPath, content);

  return { path: `${inboxFolder}/${filename}`, diskBytes };
}

/**
 * Atomically move an items_active row to items_vault post-export AND seed
 * vault_files with the freshly-written .md so the next request can resolve
 * via reverse-lookup without waiting on the 5-minute scanner cycle.
 *
 * MUST be called AFTER exportToObsidian has successfully written the .md file
 * (file-write-first, tx-after). If this transaction throws, the .md file
 * remains on disk; on next deploy the export-side pre-check raises
 * EXPORT_CRASH_RECOVERY and the operator runs `npm run vault:reconcile`.
 *
 * The vault_files INSERT writes the actual file content + hash + mtime so
 * the next scanner cycle's mtime check matches and skips re-read. UNIQUE
 * conflict on `path` would mean a stale row exists for the same path
 * (rare — scanner already deletes paths that disappeared); we ON CONFLICT
 * UPDATE to absorb it without aborting the tx.
 *
 * content_snippet is derived from the active row's content (SUBSTR first 500
 * chars). It is IMMUTABLE after this insert.
 */
export function commitExportToVault(
  db: Database.Database,
  item: {
    id: string;
    title: string;
    category_id: string | null;
    tags: string;
    aliases: string;
    source: string | null;
    origin: string | null;
    created: string;
    is_private: number;
    content: string | null;
  },
  exportPath: string,
  diskBytes?: { content: string; mtime: number; contentHash: string; frontmatter: string | null },
): void {
  const snippet = (item.content ?? "").substring(0, 500);
  const exportedAt = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO items_vault (
         id, title, category_id, tags, aliases, source, origin,
         exported_at, created, is_private, content_snippet
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      item.id,
      item.title,
      item.category_id,
      item.tags,
      item.aliases,
      item.source,
      item.origin,
      exportedAt,
      item.created,
      item.is_private,
      snippet,
    );
    db.prepare("DELETE FROM items_active WHERE id = ?").run(item.id);

    // Seed vault_files so reverse-lookup resolves immediately. Optional:
    // older callers (test fixtures) skip this; production export route
    // always passes diskBytes.
    if (diskBytes) {
      db.prepare(
        `INSERT INTO vault_files (path, title, frontmatter, content, mtime, content_hash, sparkle_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           title = excluded.title,
           frontmatter = excluded.frontmatter,
           content = excluded.content,
           mtime = excluded.mtime,
           content_hash = excluded.content_hash,
           sparkle_id = excluded.sparkle_id`,
      ).run(
        exportPath,
        item.title,
        diskBytes.frontmatter,
        diskBytes.content,
        diskBytes.mtime,
        diskBytes.contentHash,
        item.id,
      );
    }
  });
  tx();
}
