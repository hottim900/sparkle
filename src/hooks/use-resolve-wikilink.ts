import { useQuery } from "@tanstack/react-query";
import { resolveWikilink } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

/**
 * Resolve a wikilink title to its target item via /api/wikilinks/resolve.
 * Returns `null` on miss/collision so callers branch into "unresolved"
 * styling without an error fork. 5-minute staleTime — title→id is stable
 * until a rename, and PR 3's rename engine invalidates this key when it
 * commits.
 */
export function useResolveWikilink(title: string | undefined) {
  const safe = (title ?? "").trim();
  return useQuery({
    queryKey: queryKeys.wikilinks.resolve(safe),
    queryFn: () => resolveWikilink(safe),
    enabled: safe.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
