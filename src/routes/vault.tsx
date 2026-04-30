import { createFileRoute, useSearch, useNavigate } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchVault, getVaultFile } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { VaultMarkdownPreview } from "@/components/vault-markdown-preview";
import { Input } from "@/components/ui/input";
import { Search, ArrowLeft, FileText, Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Safely render FTS5 snippet HTML. Only allows <mark> tags for highlighting,
 * strips all other HTML to prevent XSS from vault file content.
 */
function HighlightedSnippet({ html }: { html: string }) {
  // Strip all HTML except <mark> and </mark>
  const safe = html.replace(/<(?!\/?mark>)[^>]*>/gi, "");
  // Split on <mark>...</mark> and render as spans
  const parts = safe.split(/(<mark>[\s\S]*?<\/mark>)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("<mark>")) {
          const text = part.replace(/<\/?mark>/g, "");
          return (
            <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
              {text}
            </mark>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function formatDate(mtime: number): string {
  return new Date(mtime).toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function VaultPage() {
  const { file, filter } = useSearch({ from: "/vault" });
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const sparkleFilter = filter === "sparkle" ? "sparkle" : undefined;

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceTimer) clearTimeout(debounceTimer);
      const timer = setTimeout(() => setDebouncedQuery(value), 300);
      setDebounceTimer(timer);
    },
    [debounceTimer],
  );

  const toggleFilter = useCallback(() => {
    const newFilter = sparkleFilter ? undefined : "sparkle";
    navigate({ to: "/vault", search: { file, filter: newFilter } });
  }, [sparkleFilter, file, navigate]);

  // Search / recent files
  const { data: searchData, isPending: isSearching } = useQuery({
    queryKey: queryKeys.vault.search(debouncedQuery, sparkleFilter),
    queryFn: () => searchVault(debouncedQuery || undefined, 200, sparkleFilter),
  });

  // Selected file detail
  const {
    data: fileData,
    isPending: isLoadingFile,
    error: fileError,
  } = useQuery({
    queryKey: queryKeys.vault.file(file || ""),
    queryFn: () => getVaultFile(file!),
    enabled: !!file,
    retry: false,
  });

  const results = searchData?.results ?? [];
  const selectedSparkleId = results.find((r) => r.path === file)?.sparkle_id ?? null;

  // Mobile: show list or detail
  const showDetail = !!file;

  return (
    <div className="flex h-full flex-1 min-w-0">
      {/* List panel */}
      <div
        className={`flex flex-col border-r border-border w-full md:w-96 md:flex-shrink-0 ${showDetail ? "hidden md:flex" : "flex"}`}
      >
        {/* Search bar + filter */}
        <div className="p-3 border-b border-border space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜尋 Vault..."
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant={sparkleFilter ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs"
            onClick={toggleFilter}
          >
            <Sparkles className="h-3 w-3 mr-1" />
            From Sparkle
          </Button>
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto">
          {isSearching && results.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">搜尋中...</div>
          ) : results.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              {debouncedQuery ? "找不到符合的檔案" : "Vault 尚未索引"}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {results.map((result) => (
                <button
                  key={result.path}
                  onClick={() => navigate({ to: "/vault", search: { file: result.path, filter } })}
                  className={`w-full text-left px-3 py-2.5 hover:bg-accent transition-colors ${file === result.path ? "bg-accent" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <FileText className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm truncate">{result.title}</span>
                        {result.sparkle_id && (
                          <Sparkles className="h-3 w-3 text-amber-500 flex-shrink-0" />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{result.path}</div>
                      {result.snippet && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          <HighlightedSnippet html={result.snippet} />
                        </div>
                      )}
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDate(result.mtime)}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className={`flex-1 flex flex-col min-w-0 ${showDetail ? "flex" : "hidden md:flex"}`}>
        {file && fileData ? (
          <>
            {/* Header with back button (mobile) */}
            <div className="flex items-center gap-2 p-3 border-b border-border">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => navigate({ to: "/vault", search: { file: undefined, filter } })}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1">
                <h1 className="font-semibold text-sm truncate">{fileData.title}</h1>
                <p className="text-xs text-muted-foreground truncate">{fileData.path}</p>
              </div>
            </div>
            {/* Sparkle source badge */}
            {selectedSparkleId && (
              <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 text-xs border-b border-border">
                <Sparkles className="h-3 w-3" />
                <span>來自 Sparkle</span>
                <a
                  href={`/item/${selectedSparkleId}`}
                  className="ml-auto hover:underline"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate({ to: "/item/$id", params: { id: selectedSparkleId } });
                  }}
                >
                  在 Sparkle 中查看
                </a>
              </div>
            )}
            {/* Content */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 p-4">
              <VaultMarkdownPreview content={fileData.content} />
            </div>
          </>
        ) : isLoadingFile && file ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            載入中...
          </div>
        ) : fileError && file ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <p>此檔案已不存在於 Vault 中</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate({ to: "/vault", search: { file: undefined, filter } })}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              返回列表
            </Button>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            選擇一個檔案以查看內容
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/vault")({
  component: VaultPage,
  validateSearch: (search: Record<string, unknown>) => ({
    file: typeof search.file === "string" ? search.file : undefined,
    filter: typeof search.filter === "string" ? search.filter : undefined,
  }),
});
