export interface Item {
  id: string;
  type: "note" | "todo";
  title: string;
  content: string;
  status: "inbox" | "active" | "done" | "archived";
  priority: "low" | "medium" | "high" | null;
  due_date: string | null;
  tags: string; // JSON array string from server
  source: string;
  created_at: string;
  updated_at: string;
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
  completed_this_week: number;
  completed_this_month: number;
  created_this_week: number;
  created_this_month: number;
  inbox_count: number;
  active_count: number;
  overdue_count: number;
}

export interface FocusResponse {
  items: Item[];
}

// Parsed item with tags as array
export interface ParsedItem extends Omit<Item, "tags"> {
  tags: string[];
}

export function parseItem(item: Item): ParsedItem {
  return {
    ...item,
    tags: JSON.parse(item.tags) as string[],
  };
}

export function parseItems(items: Item[]): ParsedItem[] {
  return items.map(parseItem);
}

export type ItemStatus = Item["status"];
export type ItemType = Item["type"];
export type ItemPriority = NonNullable<Item["priority"]>;

export type ViewType =
  | "inbox"
  | "active"
  | "all"
  | "done"
  | "archived"
  | "triage"
  | "search"
  | "notes"
  | "dashboard";
