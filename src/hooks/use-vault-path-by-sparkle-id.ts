import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { getVaultPathBySparkleId } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/**
 * Live-resolve a vault item's current path via reverse-lookup. Returns null
 * (not undefined) when the file is no longer indexed — UI branches on null
 * to render the "已從 Vault 刪除" state without an extra error path.
 *
 * Cache: 60s staleTime, no retry (404 is a load-bearing signal). On rename,
 * `keepPreviousData` keeps the old path visible until the refetch lands.
 */
export function useVaultPathBySparkleId(id: string | undefined | null) {
  return useQuery({
    queryKey: queryKeys.vault.bySparkleId(id ?? ""),
    queryFn: () => getVaultPathBySparkleId(id!),
    enabled: !!id,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}
