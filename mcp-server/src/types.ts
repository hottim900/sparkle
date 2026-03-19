/** Sparkle item as returned by the API (tags/aliases are JSON strings from server) */
export interface SparkleItem {
  id: string;
  type: "note" | "todo" | "scratch";
  title: string;
  content: string;
  status: "fleeting" | "developing" | "permanent" | "exported" | "active" | "done" | "draft" | "archived";
  priority: "low" | "medium" | "high" | null;
  due: string | null;
  tags: string; // JSON array string
  source: string | null;
  origin: string;
  aliases: string; // JSON array string
  linked_note_id: string | null;
  linked_note_title: string | null;
  linked_todo_count: number;
  share_visibility: "public" | "unlisted" | null;
  category_id: string | null;
  category_name: string | null;
  created: string;
  modified: string;
}

export interface Category {
  id: string;
  name: string;
  sort_order: number;
  color: string | null;
  created: string;
  modified: string;
}

export interface ListItemsResponse {
  items: SparkleItem[];
  total: number;
}

export interface SearchResponse {
  results: SparkleItem[];
}

export interface TagsResponse {
  tags: string[];
}

export interface StatsResponse {
  fleeting_count: number;
  developing_count: number;
  permanent_count: number;
  exported_this_week: number;
  exported_this_month: number;
  active_count: number;
  done_this_week: number;
  done_this_month: number;
  created_this_week: number;
  created_this_month: number;
  overdue_count: number;
}

export interface ExportResult {
  path: string;
}

/** Parsed frontmatter from an Obsidian vault .md file */
export interface VaultFrontmatter {
  sparkle_id?: string;
  category?: string;
  tags?: string[];
  aliases?: string[];
  source?: string;
  created?: string;
  modified?: string;
  origin?: string;
  priority?: string;
  due?: string;
  [key: string]: unknown;
}

/** A file read from the Obsidian vault */
export interface VaultFile {
  /** Relative path from vault root */
  path: string;
  /** Full file content including frontmatter */
  content: string;
  /** Parsed frontmatter key-value pairs */
  frontmatter: VaultFrontmatter;
  /** Content without frontmatter block */
  body: string;
}

/** A single search match within a vault file */
export interface VaultSearchMatch {
  line: number;
  text: string;
  context_before: string[];
  context_after: string[];
}

/** Search result for a vault file containing matches */
export interface VaultSearchResult {
  path: string;
  frontmatter: VaultFrontmatter;
  matches: VaultSearchMatch[];
}

/** A file entry in vault listing */
export interface VaultListEntry {
  path: string;
  frontmatter: VaultFrontmatter;
}

/** Result of listing vault contents */
export interface VaultListResult {
  files: VaultListEntry[];
  directories: string[];
}

/** Parse JSON array fields into actual arrays */
export function parseTags(item: SparkleItem): string[] {
  try { return JSON.parse(item.tags) as string[]; } catch { return []; }
}

export function parseAliases(item: SparkleItem): string[] {
  try { return JSON.parse(item.aliases) as string[]; } catch { return []; }
}
