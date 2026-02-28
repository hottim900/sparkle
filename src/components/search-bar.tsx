import { useState, useCallback, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { searchItemsApi } from "@/lib/api";
import { parseItems, type ParsedItem, type ItemStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Search,
  Loader2,
  Sparkles,
  Pencil,
  Gem,
  ExternalLink,
  PlayCircle,
  Check,
  Archive,
  FileText,
} from "lucide-react";

interface SearchBarProps {
  onSelect?: (item: ParsedItem) => void;
}

const STATUS_CONFIG: Record<ItemStatus, { label: string; color: string; icon: React.ReactNode }> = {
  fleeting: {
    label: "閃念",
    color: "text-amber-600 dark:text-amber-400",
    icon: <Sparkles className="h-3 w-3" />,
  },
  developing: {
    label: "發展中",
    color: "text-blue-600 dark:text-blue-400",
    icon: <Pencil className="h-3 w-3" />,
  },
  permanent: {
    label: "永久筆記",
    color: "text-green-600 dark:text-green-400",
    icon: <Gem className="h-3 w-3" />,
  },
  exported: {
    label: "已匯出",
    color: "text-purple-600 dark:text-purple-400",
    icon: <ExternalLink className="h-3 w-3" />,
  },
  active: {
    label: "進行中",
    color: "text-sky-600 dark:text-sky-400",
    icon: <PlayCircle className="h-3 w-3" />,
  },
  draft: {
    label: "草稿",
    color: "text-slate-600 dark:text-slate-400",
    icon: <FileText className="h-3 w-3" />,
  },
  done: {
    label: "已完成",
    color: "text-muted-foreground",
    icon: <Check className="h-3 w-3" />,
  },
  archived: {
    label: "已封存",
    color: "text-muted-foreground opacity-50",
    icon: <Archive className="h-3 w-3" />,
  },
};

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

function StatusBadge({ status }: { status: ItemStatus }) {
  const config = STATUS_CONFIG[status];
  if (!config) return null;
  return (
    <Badge variant="outline" className={`text-xs shrink-0 gap-0.5 ${config.color}`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

export function SearchBar({ onSelect }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ParsedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const executeSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await searchItemsApi(trimmed);
      setResults(parseItems(res.results));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "搜尋失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (!value.trim()) {
        setResults([]);
        setSearched(false);
        return;
      }
      if (value.trim().length > 1) {
        debounceRef.current = setTimeout(() => {
          executeSearch(value);
        }, 300);
      }
    },
    [executeSearch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        executeSearch(query);
      }
    },
    [executeSearch, query],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜尋..."
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
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
        <p className="text-sm text-muted-foreground text-center py-4">找不到結果</p>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">找到 {results.length} 個結果</p>
          <div className="divide-y border rounded-md">
            {results.map((item) => (
              <div
                key={item.id}
                className="p-3 cursor-pointer hover:bg-accent"
                onClick={() => onSelect?.(item)}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium min-w-0">{highlightText(item.title, query)}</p>
                  <StatusBadge status={item.status} />
                </div>
                {item.content && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {highlightText(item.content.slice(0, 200), query)}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-1 mt-1">
                  {item.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                  {item.due && <span className="text-xs text-muted-foreground">{item.due}</span>}
                  {item.origin && (
                    <span className="text-[10px] text-muted-foreground/70">
                      來源：{item.origin}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
