export interface Item {
  id: string;
  type: "note" | "todo" | "scratch";
  title: string;
  content: string;
  status: "fleeting" | "developing" | "permanent" | "exported" | "active" | "done" | "draft" | "archived";
  priority: "low" | "medium" | "high" | null;
  due: string | null;
  tags: string; // JSON array string from server
  source: string | null; // Reference URL
  origin: string; // Capture channel (was 'source')
  aliases: string; // JSON array string
  linked_note_id: string | null;
  linked_note_title: string | null;
  linked_todo_count: number;
  share_visibility: "unlisted" | "public" | null;
  created: string;
  modified: string;
}

export interface ListItemsResponse {
  items: Item[];
  total: number;
}

export interface SearchResponse {
  results: Item[];
}

export interface TagsResponse {
  tags: string[];
}

export interface ExportResponse {
  version: number;
  exported_at: string;
  items: Item[];
}

export interface ImportResponse {
  imported: number;
  updated: number;
}

export interface ApiError {
  error: string;
}

export interface StatsResponse {
  // Zettelkasten
  fleeting_count: number;
  developing_count: number;
  permanent_count: number;
  exported_this_week: number;
  exported_this_month: number;
  // GTD
  active_count: number;
  done_this_week: number;
  done_this_month: number;
  // Scratch
  scratch_count: number;
  // Shared
  created_this_week: number;
  created_this_month: number;
  overdue_count: number;
}

export interface FocusResponse {
  items: Item[];
}

export interface ConfigResponse {
  obsidian_export_enabled: boolean;
}

export interface SettingsResponse {
  obsidian_enabled: string;
  obsidian_vault_path: string;
  obsidian_inbox_folder: string;
  obsidian_export_mode: string;
}

// Parsed item with tags and aliases as arrays
export interface ParsedItem extends Omit<Item, "tags" | "aliases"> {
  tags: string[];
  aliases: string[];
}

export function parseItem(item: Item): ParsedItem {
  return {
    ...item,
    tags: JSON.parse(item.tags) as string[],
    aliases: JSON.parse(item.aliases) as string[],
  };
}

export function parseItems(items: Item[]): ParsedItem[] {
  return items.map(parseItem);
}

export type ItemStatus = Item["status"];
export type ItemType = Item["type"];
export type ItemPriority = NonNullable<Item["priority"]>;

export type ViewType =
  | "fleeting"
  | "developing"
  | "permanent"
  | "exported"
  | "active"
  | "done"
  | "draft"
  | "all"
  | "archived"
  | "search"
  | "dashboard"
  | "notes"
  | "todos"
  | "scratch"
  | "settings";

// Share types
export interface ShareToken {
  id: string;
  item_id: string;
  token: string;
  visibility: "unlisted" | "public";
  created: string;
  item_title?: string;
}

export interface ShareResponse {
  share: ShareToken;
  url: string;
}

export interface ListSharesResponse {
  shares: ShareToken[];
}
