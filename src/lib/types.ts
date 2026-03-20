export interface Item {
  id: string;
  type: "note" | "todo" | "scratch";
  title: string;
  content: string;
  status:
    | "fleeting"
    | "developing"
    | "permanent"
    | "exported"
    | "active"
    | "done"
    | "draft"
    | "archived";
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

export interface CategoriesResponse {
  categories: Category[];
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

export interface StaleItem {
  id: string;
  title: string;
  category_name: string | null;
  modified: string;
  days_stale: number;
}

export interface StaleResponse {
  items: StaleItem[];
}

export interface CategoryDistribution {
  category_id: string | null;
  category_name: string;
  color: string | null;
  count: number;
}

export interface CategoryDistributionResponse {
  distribution: CategoryDistribution[];
}

export interface ConfigResponse {
  obsidian_export_enabled: boolean;
}

export interface SettingsResponse {
  obsidian_enabled: string;
  obsidian_vault_path: string;
  obsidian_inbox_folder: string;
  obsidian_export_mode: "new" | "overwrite";
}

// Parsed item with tags and aliases as arrays
export interface ParsedItem extends Omit<Item, "tags" | "aliases"> {
  tags: string[];
  aliases: string[];
}

function safeParseStringArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.every((t) => typeof t === "string")) {
      return parsed;
    }
  } catch {
    // invalid JSON
  }
  return [];
}

export function parseItem(item: Item): ParsedItem {
  return {
    ...item,
    tags: safeParseStringArray(item.tags),
    aliases: safeParseStringArray(item.aliases),
  };
}

export function parseItems(items: Item[]): ParsedItem[] {
  return items.map(parseItem);
}

export type ItemStatus = Item["status"];
export type ItemType = Item["type"];
export type ItemPriority = NonNullable<Item["priority"]>;

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
