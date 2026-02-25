/** Sparkle item as returned by the API (tags/aliases are JSON strings from server) */
export interface SparkleItem {
  id: string;
  type: "note" | "todo";
  title: string;
  content: string;
  status: "fleeting" | "developing" | "permanent" | "exported" | "active" | "done" | "archived";
  priority: "low" | "medium" | "high" | null;
  due: string | null;
  tags: string; // JSON array string
  source: string | null;
  origin: string;
  aliases: string; // JSON array string
  linked_note_id: string | null;
  linked_note_title: string | null;
  linked_todo_count: number;
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

/** Parse JSON array fields into actual arrays */
export function parseTags(item: SparkleItem): string[] {
  try { return JSON.parse(item.tags) as string[]; } catch { return []; }
}

export function parseAliases(item: SparkleItem): string[] {
  try { return JSON.parse(item.aliases) as string[]; } catch { return []; }
}
