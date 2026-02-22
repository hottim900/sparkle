import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { searchItemsApi } from "@/lib/api";
import { parseItems, type ParsedItem } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, Loader2 } from "lucide-react";

interface SearchBarProps {
  onSelect?: (item: ParsedItem) => void;
}

function highlightText(text: string, query: string) {
  if (!query.trim()) return text;
  const words = query.trim().split(/\s+/);
  const pattern = new RegExp(`(${words.map(escapeRegex).join("|")})`, "gi");
  const parts = text.split(pattern);

  return parts.map((part, i) =>
    pattern.test(part) ? (
      <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function SearchBar({ onSelect }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ParsedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await searchItemsApi(q);
      setResults(parseItems(res.results));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "搜尋失敗");
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
            className="pl-8"
          />
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          找不到結果
        </p>
      )}

      {!loading && results.length > 0 && (
        <div className="divide-y border rounded-md">
          {results.map((item) => (
            <div
              key={item.id}
              className="p-3 cursor-pointer hover:bg-accent"
              onClick={() => onSelect?.(item)}
            >
              <p className="text-sm font-medium">
                {highlightText(item.title, query)}
              </p>
              {item.content && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                  {highlightText(item.content.slice(0, 200), query)}
                </p>
              )}
              <div className="flex gap-1 mt-1">
                {item.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
