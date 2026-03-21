import type {
  SparkleItem,
  Category,
  ListItemsResponse,
  SearchResponse,
  TagsResponse,
  StatsResponse,
  ExportResult,
} from "./types.js";

const API_URL = process.env.SPARKLE_API_URL || "http://localhost:3000";
const AUTH_TOKEN = process.env.SPARKLE_AUTH_TOKEN;

export class SparkleApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "SparkleApiError";
  }
}

async function sparkleApi<T>(
  endpoint: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  const url = `${API_URL}/api${endpoint}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (AUTH_TOKEN) {
    headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let errorMsg: string;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      errorMsg = parsed.error || `HTTP ${res.status}`;
    } catch {
      errorMsg = text || `HTTP ${res.status}`;
    }
    throw new SparkleApiError(errorMsg, res.status);
  }

  return res.json() as Promise<T>;
}

// --- Read operations ---

export async function searchItems(query: string, limit?: number): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (limit) params.set("limit", String(limit));
  return sparkleApi<SearchResponse>(`/search?${params}`);
}

export async function getItem(id: string): Promise<SparkleItem> {
  return sparkleApi<SparkleItem>(`/items/${id}`);
}

export async function listItems(params?: {
  status?: string;
  type?: string;
  tag?: string;
  category_id?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}): Promise<ListItemsResponse> {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.type) search.set("type", params.type);
  if (params?.tag) search.set("tag", params.tag);
  if (params?.category_id) search.set("category_id", params.category_id);
  if (params?.sort) search.set("sort", params.sort);
  if (params?.order) search.set("order", params.order);
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  const qs = search.toString();
  return sparkleApi<ListItemsResponse>(`/items${qs ? `?${qs}` : ""}`);
}

export async function getStats(): Promise<StatsResponse> {
  return sparkleApi<StatsResponse>("/stats");
}

export async function getTags(): Promise<TagsResponse> {
  return sparkleApi<TagsResponse>("/tags");
}

// --- Write operations ---

export async function createItem(input: {
  title: string;
  type?: string;
  content?: string;
  status?: string;
  tags?: string[];
  priority?: string | null;
  due?: string | null;
  source?: string | null;
  aliases?: string[];
  linked_note_id?: string | null;
  category_id?: string | null;
}): Promise<SparkleItem> {
  return sparkleApi<SparkleItem>("/items", "POST", { type: "note", origin: "mcp", ...input });
}

export async function updateItem(
  id: string,
  input: {
    title?: string;
    content?: string;
    status?: string;
    type?: string;
    tags?: string[];
    priority?: string | null;
    due?: string | null;
    aliases?: string[];
    source?: string | null;
    linked_note_id?: string | null;
    category_id?: string | null;
  },
): Promise<SparkleItem> {
  return sparkleApi<SparkleItem>(`/items/${id}`, "PATCH", input);
}

// --- Category operations ---

export async function listCategories(): Promise<{ categories: Category[] }> {
  return sparkleApi<{ categories: Category[] }>("/categories");
}

export async function createCategoryApi(input: {
  name: string;
  color?: string | null;
}): Promise<Category> {
  return sparkleApi<Category>("/categories", "POST", input);
}

export async function updateCategoryApi(
  id: string,
  input: { name?: string; color?: string | null; sort_order?: number },
): Promise<Category> {
  return sparkleApi<Category>(`/categories/${id}`, "PATCH", input);
}

export async function deleteCategoryApi(id: string): Promise<{ ok: boolean }> {
  return sparkleApi<{ ok: boolean }>(`/categories/${id}`, "DELETE");
}

export async function reorderCategoriesApi(
  items: { id: string; sort_order: number }[],
): Promise<{ ok: boolean }> {
  return sparkleApi<{ ok: boolean }>("/categories/reorder", "PATCH", { items });
}

// --- Dashboard operations ---

export async function getUnreviewed(
  limit = 20,
  offset = 0,
): Promise<{ items: SparkleItem[]; total: number }> {
  const params = new URLSearchParams();
  if (limit !== 20) params.set("limit", String(limit));
  if (offset) params.set("offset", String(offset));
  const qs = params.toString();
  return sparkleApi(`/dashboard/unreviewed${qs ? `?${qs}` : ""}`);
}

export async function getRecent(
  limit = 20,
  offset = 0,
): Promise<{ items: SparkleItem[]; total: number }> {
  const params = new URLSearchParams();
  if (limit !== 20) params.set("limit", String(limit));
  if (offset) params.set("offset", String(offset));
  const qs = params.toString();
  return sparkleApi(`/dashboard/recent${qs ? `?${qs}` : ""}`);
}

export async function getAttention(
  limit = 10,
): Promise<{ items: SparkleItem[]; total: number }> {
  const params = new URLSearchParams();
  if (limit !== 10) params.set("limit", String(limit));
  const qs = params.toString();
  return sparkleApi(`/dashboard/attention${qs ? `?${qs}` : ""}`);
}

export async function getDashboardStale(
  limit = 10,
): Promise<{
  items: {
    id: string;
    title: string;
    category_name: string | null;
    modified: string;
    days_stale: number;
  }[];
  total: number;
}> {
  const params = new URLSearchParams();
  if (limit !== 10) params.set("limit", String(limit));
  const qs = params.toString();
  return sparkleApi(`/dashboard/stale${qs ? `?${qs}` : ""}`);
}

// --- Settings ---

export async function getSettings(): Promise<Record<string, string>> {
  return sparkleApi<Record<string, string>>("/settings");
}

// --- Workflow operations ---

export async function exportToObsidian(id: string): Promise<ExportResult> {
  return sparkleApi<ExportResult>(`/items/${id}/export`, "POST");
}
