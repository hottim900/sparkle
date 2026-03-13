import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "@/lib/query-keys";

/**
 * Invalidate item-related queries after a mutation.
 * Covers: all item lists/details, tags, and stats.
 */
export function useInvalidateAfterItemMutation() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.tags });
    queryClient.invalidateQueries({ queryKey: queryKeys.stats });
  }, [queryClient]);
}

/**
 * Invalidate item + category queries after a mutation that may affect categories.
 * Used by: batch operations, linked item mutations.
 */
export function useInvalidateAfterItemAndCategoryMutation() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.tags });
    queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    queryClient.invalidateQueries({ queryKey: queryKeys.categories });
  }, [queryClient]);
}
