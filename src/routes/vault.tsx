import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchVault, getVaultFile } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { VaultMarkdownPreview } from "@/components/vault-markdown-preview";
import { Input } from "@/components/ui/input";
import { Search, ArrowLeft, FileText, Clock } from "lucide-react";
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
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceTimer) clearTimeout(debounceTimer);
      const timer = setTimeout(() => setDebouncedQuery(value), 300);
      setDebounceTimer(timer);
    },
    [debounceTimer],
  );

  // Search / recent files
  const { data: searchData, isPending: isSearching } = useQuery({
    queryKey: queryKeys.vault.search(debouncedQuery),
    queryFn: () => searchVault(debouncedQuery || undefined, 30),
  });

  // Selected file detail
  const { data: fileData, isPending: isLoadingFile } = useQuery({
    queryKey: queryKeys.vault.file(selectedPath || ""),
    queryFn: () => getVaultFile(selectedPath!),
    enabled: !!selectedPath,
  });

  const results = searchData?.results ?? [];

  // Mobile: show list or detail
  const showDetail = !!selectedPath;

  return (
    <div className="flex h-full">
      {/* List panel */}
      <div
        className={`flex flex-col border-r border-border w-full md:w-96 md:flex-shrink-0 ${showDetail ? "hidden md:flex" : "flex"}`}
      >
        {/* Search bar */}
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜尋 Vault..."
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>
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
              {results.map((file) => (
                <button
                  key={file.path}
                  onClick={() => setSelectedPath(file.path)}
                  className={`w-full text-left px-3 py-2.5 hover:bg-accent transition-colors ${selectedPath === file.path ? "bg-accent" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <FileText className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{file.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{file.path}</div>
                      {file.snippet && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          <HighlightedSnippet html={file.snippet} />
                        </div>
                      )}
                      <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDate(file.mtime)}
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
      <div className={`flex-1 flex flex-col ${showDetail ? "flex" : "hidden md:flex"}`}>
        {selectedPath && fileData ? (
          <>
            {/* Header with back button (mobile) */}
            <div className="flex items-center gap-2 p-3 border-b border-border">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setSelectedPath(null)}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1">
                <h1 className="font-semibold text-sm truncate">{fileData.title}</h1>
                <p className="text-xs text-muted-foreground truncate">{fileData.path}</p>
              </div>
            </div>
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              <VaultMarkdownPreview content={fileData.content} />
            </div>
          </>
        ) : isLoadingFile && selectedPath ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            載入中...
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
});
