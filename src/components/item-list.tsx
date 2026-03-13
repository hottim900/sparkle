import { useEffect, useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { useNavigate, useRouterState, type NavigateOptions } from "@tanstack/react-router";
import { listItems, batchAction, listCategories } from "@/lib/api";
import { useAppContext } from "@/lib/app-context";
import { queryKeys, type ItemFilters } from "@/lib/query-keys";
import {
  useInvalidateAfterItemMutation,
  useInvalidateAfterItemAndCategoryMutation,
} from "@/hooks/use-invalidate";
import {
  parseItems,
  type ParsedItem,
  type ItemStatus,
  type ItemType,
  type Category,
} from "@/lib/types";
import { ItemCard } from "./item-card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2,
  Inbox,
  ArrowUpDown,
  CheckSquare,
  Archive,
  Trash2,
  Pencil,
  Gem,
  ExternalLink,
  CheckCircle,
  FileText,
  ListTodo,
  StickyNote,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from "lucide-react";

type SortOption = {
  label: string;
  sort: string;
  order: string;
};

const baseSortOptions: SortOption[] = [
  { label: "最新建立", sort: "created", order: "desc" },
  { label: "最舊建立", sort: "created", order: "asc" },
  { label: "最近更新", sort: "modified", order: "desc" },
  { label: "優先度高→低", sort: "priority", order: "desc" },
];

const dueSortOption: SortOption = { label: "到期日近→遠", sort: "due", order: "asc" };

// Batch actions per view context
type BatchActionConfig = {
  action: string;
  label: string;
  icon: React.ReactNode;
  variant?: "destructive" | "ghost";
  confirm?: string;
};

function getBatchActions(status?: ItemStatus, obsidianEnabled?: boolean): BatchActionConfig[] {
  const universal: BatchActionConfig[] = [
    { action: "archive", label: "封存", icon: <Archive className="h-3.5 w-3.5" /> },
    {
      action: "delete",
      label: "刪除",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      variant: "destructive",
      confirm: "確定要刪除所選項目嗎？此操作無法復原。",
    },
  ];

  switch (status) {
    case "fleeting":
      return [
        { action: "develop", label: "發展", icon: <Pencil className="h-3.5 w-3.5" /> },
        ...universal,
      ];
    case "developing":
      return [
        { action: "mature", label: "成熟", icon: <Gem className="h-3.5 w-3.5" /> },
        ...universal,
      ];
    case "permanent": {
      const actions: BatchActionConfig[] = [];
      if (obsidianEnabled) {
        actions.push({
          action: "export",
          label: "匯出",
          icon: <ExternalLink className="h-3.5 w-3.5" />,
        });
      }
      return [...actions, ...universal];
    }
    case "active":
      return [
        { action: "done", label: "完成", icon: <CheckCircle className="h-3.5 w-3.5" /> },
        ...universal,
      ];
    case "draft":
      return [
        {
          action: "delete",
          label: "刪除",
          icon: <Trash2 className="h-3.5 w-3.5" />,
          variant: "destructive",
          confirm: "確定要刪除所選項目嗎？此操作無法復原。",
        },
        { action: "archive", label: "封存", icon: <Archive className="h-3.5 w-3.5" /> },
      ];
    default:
      return universal;
  }
}

interface ItemListProps {
  status?: ItemStatus;
  type?: ItemType;
}

export function ItemList({ status, type }: ItemListProps) {
  const { obsidianEnabled, isOnline } = useAppContext();
  const navigate = useNavigate();
  const invalidateAfterItemMutation = useInvalidateAfterItemMutation();
  const invalidateAfterItemAndCategoryMutation = useInvalidateAfterItemAndCategoryMutation();

  // Read search params from URL — use primitive selectors to avoid spurious re-renders
  const tag = useRouterState({
    select: (s) => {
      const search = s.location.search as Record<string, unknown>;
      return typeof search.tag === "string" ? search.tag : undefined;
    },
  });
  const selectedId = useRouterState({
    select: (s) => {
      const search = s.location.search as Record<string, unknown>;
      return typeof search.item === "string" ? search.item : undefined;
    },
  });

  const [offset, setOffset] = useState(0);
  const [sortIdx, setSortIdx] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const limit = 50;

  const isNoteType = type === "note";
  const isTodoType = type === "todo";
  const isScratchType = type === "scratch";
  const sortOptions =
    isNoteType || isScratchType ? baseSortOptions : [...baseSortOptions, dueSortOption];
  const defaultSortIdx = isTodoType ? sortOptions.length - 1 : 0;
  const safeSortIdx = sortIdx < sortOptions.length ? sortIdx : defaultSortIdx;
  const currentSort = sortOptions[safeSortIdx];

  // Items query
  const filters: ItemFilters = {
    status,
    type,
    tag,
    sort: currentSort?.sort ?? "created",
    order: currentSort?.order ?? "desc",
    limit,
    offset,
  };

  const {
    data: itemsData,
    isPending,
    error: itemsError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.items.list(filters),
    queryFn: () => listItems(filters),
    placeholderData: keepPreviousData,
  });

  // Categories query
  const { data: categoriesData } = useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => listCategories().then((r) => r.categories),
  });

  // Derived data from queries
  const items = useMemo(() => parseItems(itemsData?.items ?? []), [itemsData?.items]);
  const total = itemsData?.total ?? 0;
  const categories = useMemo(() => categoriesData ?? [], [categoriesData]);

  // Error handling for items query
  useEffect(() => {
    if (itemsError) {
      toast.error(itemsError instanceof Error ? itemsError.message : "載入失敗");
    }
  }, [itemsError]);

  // Reset sort to view-appropriate default when switching views
  useEffect(() => {
    if (isScratchType) {
      setSortIdx(2); // "最近更新" (index 2 in baseSortOptions)
    } else if (isTodoType) {
      setSortIdx(sortOptions.length - 1);
    } else {
      setSortIdx(0);
    }
  }, [status, type, isScratchType, isTodoType, sortOptions.length]);

  useEffect(() => {
    setOffset(0);
  }, [status, type, tag, safeSortIdx]);

  const categoriesMap = useMemo(() => {
    const map = new Map<string, Category>();
    for (const cat of categories) {
      map.set(cat.id, cat);
    }
    return map;
  }, [categories]);

  // Group items by category_id
  const categoryGroups = useMemo(() => {
    const hasAnyCategorized = items.some((i) => i.category_id != null);
    if (!hasAnyCategorized) return null; // flat list

    const groups = new Map<string | null, ParsedItem[]>();
    for (const item of items) {
      const key = item.category_id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }

    // Sort keys: categories by sort_order, null last
    const sortedKeys = [...groups.keys()].sort((a, b) => {
      if (a === null) return 1;
      if (b === null) return -1;
      const catA = categoriesMap.get(a);
      const catB = categoriesMap.get(b);
      return (catA?.sort_order ?? 0) - (catB?.sort_order ?? 0);
    });

    return sortedKeys.map((key) => ({
      key: key ?? "uncategorized",
      name: key ? (categoriesMap.get(key)?.name ?? "未知分類") : "未分類",
      color: key ? (categoriesMap.get(key)?.color ?? null) : null,
      items: groups.get(key)!,
    }));
  }, [items, categoriesMap]);

  const toggleCategoryCollapse = (key: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i) => i.id)));
    }
  };

  const batchMutation = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: string }) => batchAction(ids, action),
    onSuccess: invalidateAfterItemAndCategoryMutation,
  });

  const handleBatchAction = async (config: BatchActionConfig) => {
    if (selectedIds.size === 0) return;

    if (config.confirm) {
      const confirmed = window.confirm(
        config.confirm.replace("所選項目", `所選的 ${selectedIds.size} 個項目`),
      );
      if (!confirmed) return;
    }

    try {
      const result = await batchMutation.mutateAsync({
        ids: Array.from(selectedIds),
        action: config.action,
      });
      const skippedMsg = result.skipped > 0 ? `，跳過 ${result.skipped} 筆` : "";

      if (config.action === "export" && result.skipped > 0) {
        const errorCount = result.errors?.length ?? 0;
        const failMsg = errorCount > 0 ? `${errorCount} 筆失敗` : `${result.skipped} 筆跳過`;
        toast.warning(`匯出 ${result.affected} 筆成功，${failMsg}`);
      } else {
        toast.success(`已${config.label} ${result.affected} 個項目${skippedMsg}`);
      }
      exitSelectionMode();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批次操作失敗");
    }
  };

  const handleItemUpdated = invalidateAfterItemMutation;

  const handleSelect = useCallback(
    (item: ParsedItem) => {
      navigate({
        search: (prev: Record<string, unknown>) => ({ ...prev, item: item.id }),
      } as NavigateOptions);
    },
    [navigate],
  );

  const handleNavigate = useCallback(
    (itemId: string) => {
      navigate({
        search: (prev: Record<string, unknown>) => ({ ...prev, item: itemId }),
      } as NavigateOptions);
    },
    [navigate],
  );

  const batchActions = getBatchActions(status, obsidianEnabled);

  // Determine if this is an "all" or "archived" view (no specific type)
  const isAllView = !type && !status;
  const isArchivedView = !type && status === "archived";
  const showTypeGroups = isAllView || isArchivedView;

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (itemsError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <AlertCircle className="h-10 w-10 mb-2" />
        <p className="text-sm">載入失敗</p>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="mt-2">
          重試
        </Button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Inbox className="h-10 w-10 mb-2" />
        <p className="text-sm">沒有項目</p>
      </div>
    );
  }

  return (
    <div>
      {selectionMode ? (
        <div className="flex items-center gap-2 px-3 py-2 border-b flex-wrap">
          <span className="text-sm text-muted-foreground">已選 {selectedIds.size} 項</span>
          <div className="flex-1" />
          <Button variant="ghost" size="xs" onClick={toggleSelectAll}>
            {selectedIds.size === items.length ? "取消全選" : "全選"}
          </Button>
          {batchActions.map((config) => (
            <Button
              key={config.action}
              variant={config.variant ?? "ghost"}
              size="xs"
              onClick={() => handleBatchAction(config)}
            >
              {config.icon}
              {config.label}
            </Button>
          ))}
          <Button variant="ghost" size="xs" onClick={exitSelectionMode}>
            取消
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <Select value={String(safeSortIdx)} onValueChange={(v) => setSortIdx(Number(v))}>
            <SelectTrigger className="h-7 w-auto gap-1.5 border-none shadow-none text-muted-foreground text-xs px-2 hover:text-foreground">
              <ArrowUpDown className="h-3 w-3" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((opt, i) => (
                <SelectItem key={i} value={String(i)} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setSelectionMode(true)}
            title="多選模式"
            aria-label="多選模式"
            disabled={!isOnline}
          >
            <CheckSquare className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      <div className="divide-y">
        {showTypeGroups
          ? (() => {
              const notes = items.filter((i) => i.type === "note");
              const todos = items.filter((i) => i.type === "todo");
              const scratches = items.filter((i) => i.type === "scratch");
              return (
                <>
                  {notes.length > 0 && (
                    <>
                      <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/50 sticky top-0 z-10">
                        <FileText className="h-3.5 w-3.5" />
                        筆記
                        <span className="text-muted-foreground/60">({notes.length})</span>
                      </div>
                      {notes.map((item) => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          selected={item.id === selectedId}
                          onSelect={handleSelect}
                          onNavigate={handleNavigate}
                          onUpdated={handleItemUpdated}
                          selectionMode={selectionMode}
                          checked={selectedIds.has(item.id)}
                          onToggle={toggleSelection}
                        />
                      ))}
                    </>
                  )}
                  {todos.length > 0 && (
                    <>
                      <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/50 sticky top-0 z-10">
                        <ListTodo className="h-3.5 w-3.5" />
                        待辦
                        <span className="text-muted-foreground/60">({todos.length})</span>
                      </div>
                      {todos.map((item) => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          selected={item.id === selectedId}
                          onSelect={handleSelect}
                          onNavigate={handleNavigate}
                          onUpdated={handleItemUpdated}
                          selectionMode={selectionMode}
                          checked={selectedIds.has(item.id)}
                          onToggle={toggleSelection}
                        />
                      ))}
                    </>
                  )}
                  {scratches.length > 0 && (
                    <>
                      <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/50 sticky top-0 z-10">
                        <StickyNote className="h-3.5 w-3.5" />
                        暫存
                        <span className="text-muted-foreground/60">({scratches.length})</span>
                      </div>
                      {scratches.map((item) => (
                        <ItemCard
                          key={item.id}
                          item={item}
                          selected={item.id === selectedId}
                          onSelect={handleSelect}
                          onNavigate={handleNavigate}
                          onUpdated={handleItemUpdated}
                          selectionMode={selectionMode}
                          checked={selectedIds.has(item.id)}
                          onToggle={toggleSelection}
                        />
                      ))}
                    </>
                  )}
                </>
              );
            })()
          : categoryGroups
            ? categoryGroups.map((group) => (
                <div key={group.key}>
                  <div
                    data-testid="category-group-header"
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/50 sticky top-0 z-10 cursor-pointer select-none hover:bg-muted/80"
                    onClick={() => toggleCategoryCollapse(group.key)}
                  >
                    {collapsedCategories.has(group.key) ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    {group.color && (
                      <span
                        className="inline-block size-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: group.color }}
                      />
                    )}
                    {group.name}
                    <span className="text-muted-foreground/60">({group.items.length})</span>
                  </div>
                  {!collapsedCategories.has(group.key) &&
                    group.items.map((item) => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        selected={item.id === selectedId}
                        onSelect={handleSelect}
                        onNavigate={handleNavigate}
                        onUpdated={handleItemUpdated}
                        selectionMode={selectionMode}
                        checked={selectedIds.has(item.id)}
                        onToggle={toggleSelection}
                      />
                    ))}
                </div>
              ))
            : items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onSelect={handleSelect}
                  onNavigate={handleNavigate}
                  onUpdated={handleItemUpdated}
                  selectionMode={selectionMode}
                  checked={selectedIds.has(item.id)}
                  onToggle={toggleSelection}
                />
              ))}
        {total > offset + limit && (
          <button
            className="w-full py-3 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setOffset((o) => o + limit)}
          >
            載入更多...
          </button>
        )}
      </div>
    </div>
  );
}
