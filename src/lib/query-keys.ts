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
    list: (filters: ItemFilters) => ["items", "list", filters] as const,
    detail: (id: string) => ["items", "detail", id] as const,
    linkedTodos: (noteId: string) => ["items", "linkedTodos", noteId] as const,
  },
  categories: ["categories"] as const,
  tags: ["tags"] as const,
  stats: ["stats"] as const,
  focus: ["focus"] as const,
  config: ["config"] as const,
} as const;
