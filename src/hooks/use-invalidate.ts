import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "@/lib/query-keys";

// Fields that affect list query results (filtering, sorting, display)
const LIST_FIELDS = new Set(["title", "status", "type", "priority", "due", "tags", "category_id"]);
const TAG_FIELDS = new Set(["tags"]);
const STATS_FIELDS = new Set(["status", "type"]);
// Fields that affect linked todo counts (status changes can archive/unarchive todos)
const LINKED_TODO_FIELDS = new Set(["status", "type", "linked_note_id"]);

/**
 * Shared field-aware invalidation logic.
 * When `field` is provided, only invalidates queries affected by that field.
 * When omitted, blanket invalidation (create/delete/batch).
 */
function invalidateItemFields(queryClient: QueryClient, field?: string) {
  if (!field) {
    queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.tags });
    queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    queryClient.invalidateQueries({ queryKey: queryKeys.unreviewed });
    queryClient.invalidateQueries({ queryKey: queryKeys.recent });
    queryClient.invalidateQueries({ queryKey: queryKeys.attention });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStale });
    return;
  }

  // Any field change affects detail views
  queryClient.invalidateQueries({ queryKey: queryKeys.items.details });

  if (LIST_FIELDS.has(field)) {
    queryClient.invalidateQueries({ queryKey: queryKeys.items.lists });
  }
  if (TAG_FIELDS.has(field)) {
    queryClient.invalidateQueries({ queryKey: queryKeys.tags });
  }
  if (STATS_FIELDS.has(field)) {
    queryClient.invalidateQueries({ queryKey: queryKeys.stats });
  }
  if (LINKED_TODO_FIELDS.has(field)) {
    queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
  }
}

/**
 * Invalidate item-related queries after a mutation.
 *
 * When `field` is provided, only invalidates queries affected by that field:
 * - content/source/aliases → details only (lists unaffected)
 * - title/priority/due → details + lists
 * - tags → details + lists + tags
 * - status/type → details + lists + stats + linkedTodos
 *
 * When `field` is omitted, blanket invalidation (create/delete/batch).
 */
export function useInvalidateAfterItemMutation() {
  const queryClient = useQueryClient();
  return useCallback((field?: string) => invalidateItemFields(queryClient, field), [queryClient]);
}

/**
 * Invalidate item + category queries after a mutation that may affect categories.
 * Used by: batch operations, linked item mutations.
 */
export function useInvalidateAfterItemAndCategoryMutation() {
  const queryClient = useQueryClient();
  return useCallback(
    (field?: string) => {
      invalidateItemFields(queryClient, field);
      if (!field || field === "category_id") {
        queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      }
    },
    [queryClient],
  );
}
