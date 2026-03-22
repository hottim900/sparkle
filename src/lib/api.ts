import type {
  Item,
  Category,
  CategoriesResponse,
  ListItemsResponse,
  SearchResponse,
  TagsResponse,
  ExportResponse,
  ImportResponse,
  StatsResponse,
  FocusResponse,
  StaleResponse,
  CategoryDistributionResponse,
  ConfigResponse,
  SettingsResponse,
  ShareResponse,
  ListSharesResponse,
  DashboardItemsResponse,
  AttentionResponse,
  DashboardStaleResponse,
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

// --- Retry + Timeout ---

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 5_000;

const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "DELETE", "OPTIONS"]);

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network/i.test(error.message);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function getRetryDelay(attempt: number): number {
  const exponential = BASE_DELAY_MS * Math.pow(2, attempt);
  const capped = Math.min(exponential, MAX_DELAY_MS);
  const jitter = Math.random() * 500;
  return capped + jitter;
}

function shouldRetry(error: unknown, status: number | null, method: string): boolean {
  if (status !== null && status >= 400 && status < 500) return false;
  if (isNetworkError(error) || isTimeoutError(error)) return true;
  if (status !== null && status >= 500) return IDEMPOTENT_METHODS.has(method.toUpperCase());
  return false;
}

export async function fetchWithRetry(url: string, options: RequestInit = {}): Promise<Response> {
  const method = (options.method ?? "GET").toUpperCase();
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timeoutId);

      if (response.ok || (response.status >= 400 && response.status < 500)) {
        return response;
      }

      // 5xx — check if retryable
      if (!shouldRetry(null, response.status, method) || attempt === MAX_ATTEMPTS - 1) {
        return response;
      }

      lastError = new Error(`HTTP ${response.status}`);
      await new Promise((resolve) => setTimeout(resolve, getRetryDelay(attempt)));
    } catch (error) {
      clearTimeout(timeoutId);

      if (!shouldRetry(error, null, method) || attempt === MAX_ATTEMPTS - 1) {
        if (isTimeoutError(error)) {
          throw new ApiClientError("Request timed out", 0);
        }
        if (isNetworkError(error) && navigator.onLine) {
          // CF Access session likely expired — auto-reload to re-authenticate.
          // Guard with sessionStorage to prevent infinite reload loops
          // (e.g. if server is actually down, reload won't help).
          const RELOAD_KEY = "cf_auth_reload";
          const RELOAD_COOLDOWN_MS = 30_000;
          const lastReload = sessionStorage.getItem(RELOAD_KEY);
          const now = Date.now();
          if (!lastReload || now - Number(lastReload) > RELOAD_COOLDOWN_MS) {
            sessionStorage.setItem(RELOAD_KEY, String(now));
            window.location.reload();
            throw new ApiClientError("重新驗證中…", 0);
          }
          throw new ApiClientError("連線已過期，請重新整理頁面以重新驗證", 0);
        }
        throw error;
      }

      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, getRetryDelay(attempt)));
    }
  }

  if (isTimeoutError(lastError)) {
    throw new ApiClientError("Request timed out", 0);
  }
  throw lastError;
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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

  const res = await fetchWithRetry(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      window.location.reload();
    }
    const body = await res.json().catch(() => ({ error: "Request failed" }));
    throw new ApiClientError((body as { error?: string }).error ?? "Request failed", res.status);
  }

  return res.json() as Promise<T>;
}

// Items API
export async function listItems(params?: {
  status?: string;
  type?: string;
  tag?: string;
  category_id?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
  excludeStatus?: string[];
}): Promise<ListItemsResponse> {
  // Source of truth: server/schemas/items.ts statusEnum
  const validStatuses = new Set([
    "fleeting",
    "developing",
    "permanent",
    "exported",
    "active",
    "done",
    "draft",
    "archived",
  ]);
  const search = new URLSearchParams();
  if (params?.status && validStatuses.has(params.status)) search.set("status", params.status);
  if (params?.type) search.set("type", params.type);
  if (params?.tag) search.set("tag", params.tag);
  if (params?.category_id) search.set("category_id", params.category_id);
  if (params?.sort) search.set("sort", params.sort);
  if (params?.order) search.set("order", params.order);
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  if (params?.excludeStatus) {
    for (const s of params.excludeStatus) {
      search.append("excludeStatus", s);
    }
  }

  const qs = search.toString();
  return request<ListItemsResponse>(`/items${qs ? `?${qs}` : ""}`);
}

export async function createItem(input: {
  title: string;
  type?: string;
  content?: string;
  status?: string;
  priority?: string | null;
  due?: string | null;
  tags?: string[];
  source?: string | null;
  origin?: string;
  linked_note_id?: string | null;
  category_id?: string | null;
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
    due?: string | null;
    tags?: string[];
    source?: string | null;
    aliases?: string[];
    linked_note_id?: string | null;
    category_id?: string | null;
    viewed_at?: string | null;
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
): Promise<{ affected: number; skipped: number; errors?: { id: string; error: string }[] }> {
  return request<{ affected: number; skipped: number; errors?: { id: string; error: string }[] }>(
    "/items/batch",
    {
      method: "POST",
      body: JSON.stringify({ ids, action }),
    },
  );
}

// Export to Obsidian API
export async function exportItem(id: string): Promise<{ path: string }> {
  return request<{ path: string }>(`/items/${id}/export`, {
    method: "POST",
  });
}

// Linked Todos API
export async function getLinkedTodos(noteId: string): Promise<ListItemsResponse> {
  return request<ListItemsResponse>(`/items/${noteId}/linked-todos`);
}

// Search API
export async function searchItemsApi(q: string, limit?: number): Promise<SearchResponse> {
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

export async function importData(data: { items: Item[] }): Promise<ImportResponse> {
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

export async function getStaleNotes(): Promise<StaleResponse> {
  return request<StaleResponse>("/stats/stale");
}

export async function getCategoryDistribution(): Promise<CategoryDistributionResponse> {
  return request<CategoryDistributionResponse>("/stats/category-distribution");
}

// Config API
export async function getConfig(): Promise<ConfigResponse> {
  return request<ConfigResponse>("/config");
}

// Settings API
export async function getSettings(): Promise<SettingsResponse> {
  return request<SettingsResponse>("/settings");
}

export async function updateSettings(data: Partial<SettingsResponse>): Promise<SettingsResponse> {
  return request<SettingsResponse>("/settings", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// Shares API
export async function createShare(
  itemId: string,
  visibility: "unlisted" | "public" = "unlisted",
): Promise<ShareResponse> {
  return request<ShareResponse>(`/items/${itemId}/share`, {
    method: "POST",
    body: JSON.stringify({ visibility }),
  });
}

export async function listShares(): Promise<ListSharesResponse> {
  return request<ListSharesResponse>("/shares");
}

export async function getItemShares(itemId: string): Promise<ListSharesResponse> {
  return request<ListSharesResponse>(`/items/${itemId}/shares`);
}

export async function revokeShare(shareId: string): Promise<void> {
  await request(`/shares/${shareId}`, { method: "DELETE" });
}

// Categories API
export async function listCategories(): Promise<CategoriesResponse> {
  return request<CategoriesResponse>("/categories");
}

export async function createCategory(input: {
  name: string;
  color?: string | null;
}): Promise<Category> {
  return request<Category>("/categories", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateCategory(
  id: string,
  input: { name?: string; color?: string | null; sort_order?: number },
): Promise<Category> {
  return request<Category>(`/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteCategory(id: string): Promise<void> {
  await request(`/categories/${id}`, { method: "DELETE" });
}

export async function reorderCategories(
  items: { id: string; sort_order: number }[],
): Promise<void> {
  await request("/categories/reorder", {
    method: "PATCH",
    body: JSON.stringify({ items }),
  });
}

// Dashboard API
export async function getUnreviewed(params?: {
  limit?: number;
  offset?: number;
}): Promise<DashboardItemsResponse> {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  const qs = search.toString();
  return request<DashboardItemsResponse>(`/dashboard/unreviewed${qs ? `?${qs}` : ""}`);
}

export async function getRecent(params?: {
  limit?: number;
  offset?: number;
}): Promise<DashboardItemsResponse> {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  const qs = search.toString();
  return request<DashboardItemsResponse>(`/dashboard/recent${qs ? `?${qs}` : ""}`);
}

export async function getAttention(params?: { limit?: number }): Promise<AttentionResponse> {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return request<AttentionResponse>(`/dashboard/attention${qs ? `?${qs}` : ""}`);
}

export async function getDashboardStale(params?: {
  limit?: number;
}): Promise<DashboardStaleResponse> {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return request<DashboardStaleResponse>(`/dashboard/stale${qs ? `?${qs}` : ""}`);
}

export { ApiClientError };
