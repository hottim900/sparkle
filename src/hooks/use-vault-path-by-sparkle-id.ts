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

type ItemLike =
  | { id: string; origin: "active" | "vault"; export_path: string | null }
  | null
  | undefined;

/**
 * Derived state for the dual-write window: combines reverse-lookup with the
 * items_vault.export_path snapshot fallback. Returns the same three render
 * branches the slate bar + body link both consume, so the two callsites stay
 * in sync (no "header says deleted, body says loading" drift).
 */
export function useResolvedVaultPath(item: ItemLike): {
  resolvedVaultPath: string | null;
  isLoading: boolean;
  isDeleted: boolean;
} {
  const isVault = item?.origin === "vault";
  const query = useVaultPathBySparkleId(isVault ? item!.id : undefined);
  const fallback = item?.export_path ?? null;
  const live = query.data?.path ?? null;
  return {
    resolvedVaultPath: live ?? fallback,
    isLoading: isVault && query.isLoading && !fallback,
    isDeleted: isVault && !query.isLoading && query.data === null && !fallback,
  };
}
