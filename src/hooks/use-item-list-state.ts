import { useEffect, useState, useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listItems, listCategories } from "@/lib/api";
import { queryKeys, type ItemFilters } from "@/lib/query-keys";
import {
  parseItems,
  type ParsedItem,
  type ItemStatus,
  type ItemType,
  type Category,
} from "@/lib/types";
import { toast } from "sonner";

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

export type CategoryGroup = {
  key: string;
  name: string;
  color: string | null;
  items: ParsedItem[];
};

export function useItemListState(props: { status?: ItemStatus; type?: ItemType; tag?: string }) {
  const { status, type, tag } = props;

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

  // Derived data
  const items = useMemo(() => parseItems(itemsData?.items ?? []), [itemsData?.items]);
  const total = itemsData?.total ?? 0;
  const categories = useMemo(() => categoriesData ?? [], [categoriesData]);

  // Error toast
  useEffect(() => {
    if (itemsError) {
      toast.error(itemsError instanceof Error ? itemsError.message : "載入失敗");
    }
  }, [itemsError]);

  // Reset sort on view change
  useEffect(() => {
    if (isScratchType) {
      setSortIdx(2);
    } else if (isTodoType) {
      setSortIdx(sortOptions.length - 1);
    } else {
      setSortIdx(0);
    }
  }, [status, type, isScratchType, isTodoType, sortOptions.length]);

  // Reset offset on filter change
  useEffect(() => {
    setOffset(0);
  }, [status, type, tag, safeSortIdx]);

  // Category grouping
  const categoriesMap = useMemo(() => {
    const map = new Map<string, Category>();
    for (const cat of categories) {
      map.set(cat.id, cat);
    }
    return map;
  }, [categories]);

  const categoryGroups = useMemo((): CategoryGroup[] | null => {
    const hasAnyCategorized = items.some((i) => i.category_id != null);
    if (!hasAnyCategorized) return null;

    const groups = new Map<string | null, ParsedItem[]>();
    for (const item of items) {
      const key = item.category_id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }

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

  // Selection helpers
  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
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

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const toggleCategoryCollapse = (key: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return {
    items,
    total,
    categoryGroups,
    isPending,
    itemsError,
    refetch,
    offset,
    setOffset,
    limit,
    sortIdx: safeSortIdx,
    setSortIdx,
    sortOptions,
    selectionMode,
    setSelectionMode,
    selectedIds,
    toggleSelection,
    toggleSelectAll,
    exitSelectionMode,
    collapsedCategories,
    toggleCategoryCollapse,
  };
}
