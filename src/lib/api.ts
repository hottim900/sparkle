import type {
  Item,
  ListItemsResponse,
  SearchResponse,
  TagsResponse,
  ExportResponse,
  ImportResponse,
  StatsResponse,
  FocusResponse,
} from "./types";

const API_BASE = "/api";

function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

export function setToken(token: string) {
  localStorage.setItem("auth_token", token);
}

export function clearToken() {
  localStorage.removeItem("auth_token");
}

export function hasToken(): boolean {
  return !!getToken();
}

class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (options.body && typeof options.body === "string") {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Request failed" }));
    throw new ApiClientError(
      (body as { error?: string }).error ?? "Request failed",
      res.status,
    );
  }

  return res.json() as Promise<T>;
}

// Items API
export async function listItems(params?: {
  status?: string;
  type?: string;
  tag?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}): Promise<ListItemsResponse> {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.type) search.set("type", params.type);
  if (params?.tag) search.set("tag", params.tag);
  if (params?.sort) search.set("sort", params.sort);
  if (params?.order) search.set("order", params.order);
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));

  const qs = search.toString();
  return request<ListItemsResponse>(`/items${qs ? `?${qs}` : ""}`);
}

export async function createItem(input: {
  title: string;
  type?: string;
  content?: string;
  status?: string;
  priority?: string | null;
  due_date?: string | null;
  tags?: string[];
  source?: string;
}): Promise<Item> {
  return request<Item>("/items", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getItem(id: string): Promise<Item> {
  return request<Item>(`/items/${id}`);
}

export async function updateItem(
  id: string,
  input: {
    title?: string;
    type?: string;
    content?: string;
    status?: string;
    priority?: string | null;
    due_date?: string | null;
    tags?: string[];
    source?: string;
  },
): Promise<Item> {
  return request<Item>(`/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteItem(id: string): Promise<void> {
  await request(`/items/${id}`, { method: "DELETE" });
}

// Batch API
export async function batchAction(
  ids: string[],
  action: string,
): Promise<{ affected: number }> {
  return request<{ affected: number }>("/items/batch", {
    method: "POST",
    body: JSON.stringify({ ids, action }),
  });
}

// Search API
export async function searchItemsApi(
  q: string,
  limit?: number,
): Promise<SearchResponse> {
  const search = new URLSearchParams({ q });
  if (limit) search.set("limit", String(limit));
  return request<SearchResponse>(`/search?${search}`);
}

// Tags API
export async function getTags(): Promise<TagsResponse> {
  return request<TagsResponse>("/tags");
}

// Export/Import API
export async function exportData(): Promise<ExportResponse> {
  return request<ExportResponse>("/export");
}

export async function importData(data: {
  items: Item[];
}): Promise<ImportResponse> {
  return request<ImportResponse>("/import", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// Stats API
export async function getStats(): Promise<StatsResponse> {
  return request<StatsResponse>("/stats");
}

export async function getFocus(): Promise<FocusResponse> {
  return request<FocusResponse>("/stats/focus");
}

export { ApiClientError };
