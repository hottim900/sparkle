export interface ItemFilters {
  status?: string;
  type?: string;
  tag?: string;
  category_id?: string;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
  excludeStatus?: string[];
}

export const queryKeys = {
  items: {
    all: ["items"] as const,
    lists: ["items", "list"] as const,
    details: ["items", "detail"] as const,
    list: (filters: ItemFilters) => ["items", "list", filters] as const,
    detail: (id: string) => ["items", "detail", id] as const,
    linkedTodos: (noteId: string) => ["items", "linkedTodos", noteId] as const,
  },
  categories: ["categories"] as const,
  tags: ["tags"] as const,
  stats: ["stats"] as const,
  focus: ["focus"] as const,
  stale: ["stale"] as const,
  categoryDistribution: ["categoryDistribution"] as const,
  config: ["config"] as const,
  unreviewed: ["unreviewed"] as const,
  recent: ["recent"] as const,
  attention: ["attention"] as const,
  dashboardStale: ["dashboardStale"] as const,
  private: {
    status: ["private", "status"] as const,
    list: (filters?: Record<string, string>) => ["private", "items", filters ?? {}] as const,
    detail: (id: string) => ["private", "items", id] as const,
    tags: ["private", "tags"] as const,
    search: (q: string) => ["private", "search", q] as const,
  },
} as const;
