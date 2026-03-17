import { useCallback } from "react";
import { useNavigate, useRouterState, type NavigateOptions } from "@tanstack/react-router";
import { useAppContext } from "@/lib/app-context";
import {
  useInvalidateAfterItemMutation,
  useInvalidateAfterItemAndCategoryMutation,
} from "@/hooks/use-invalidate";
import type { ParsedItem, ItemStatus, ItemType } from "@/lib/types";
import { useItemListState } from "@/hooks/use-item-list-state";
import { useBatchActions } from "@/hooks/use-batch-actions";
import { getBatchActions } from "@/lib/batch-actions";
import { ItemCard } from "./item-card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Inbox,
  ArrowUpDown,
  CheckSquare,
  FileText,
  ListTodo,
  StickyNote,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from "lucide-react";

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

  const state = useItemListState({ status, type, tag });
  const { handleBatchAction, isBatchPending } = useBatchActions(
    state.selectedIds,
    state.exitSelectionMode,
    invalidateAfterItemAndCategoryMutation,
  );

  const navigateToItem = useCallback(
    (itemId: string) => {
      navigate({
        search: (prev) => ({ ...prev, item: itemId }),
      } as NavigateOptions);
    },
    [navigate],
  );

  const handleSelect = useCallback((item: ParsedItem) => navigateToItem(item.id), [navigateToItem]);

  const batchActions = getBatchActions(status, obsidianEnabled);

  // Determine if this is an "all" or "archived" view (no specific type)
  const isAllView = !type && !status;
  const isArchivedView = !type && status === "archived";
  const showTypeGroups = isAllView || isArchivedView;

  if (state.isPending) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state.itemsError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <AlertCircle className="h-10 w-10 mb-2" />
        <p className="text-sm">載入失敗</p>
        <Button variant="ghost" size="sm" onClick={() => state.refetch()} className="mt-2">
          重試
        </Button>
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Inbox className="h-10 w-10 mb-2" />
        <p className="text-sm">沒有項目</p>
      </div>
    );
  }

  const renderItemCard = (item: ParsedItem) => (
    <ItemCard
      key={item.id}
      item={item}
      selected={item.id === selectedId}
      onSelect={handleSelect}
      onNavigate={navigateToItem}
      onUpdated={invalidateAfterItemMutation}
      selectionMode={state.selectionMode}
      checked={state.selectedIds.has(item.id)}
      onToggle={state.toggleSelection}
    />
  );

  return (
    <div>
      {state.selectionMode ? (
        <div className="flex items-center gap-2 px-3 py-2 border-b flex-wrap">
          <span className="text-sm text-muted-foreground">已選 {state.selectedIds.size} 項</span>
          <div className="flex-1" />
          <Button variant="ghost" size="xs" onClick={state.toggleSelectAll}>
            {state.selectedIds.size === state.items.length ? "取消全選" : "全選"}
          </Button>
          {batchActions.map((config) => (
            <Button
              key={config.action}
              variant={config.variant ?? "ghost"}
              size="xs"
              disabled={isBatchPending}
              onClick={() => handleBatchAction(config)}
            >
              {config.icon}
              {config.label}
            </Button>
          ))}
          <Button variant="ghost" size="xs" onClick={state.exitSelectionMode}>
            取消
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <Select value={String(state.sortIdx)} onValueChange={(v) => state.setSortIdx(Number(v))}>
            <SelectTrigger className="h-7 w-auto gap-1.5 border-none shadow-none text-muted-foreground text-xs px-2 hover:text-foreground">
              <ArrowUpDown className="h-3 w-3" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {state.sortOptions.map((opt, i) => (
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
            onClick={() => state.setSelectionMode(true)}
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
              const notes = state.items.filter((i) => i.type === "note");
              const todos = state.items.filter((i) => i.type === "todo");
              const scratches = state.items.filter((i) => i.type === "scratch");
              return (
                <>
                  {notes.length > 0 && (
                    <>
                      <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/50 sticky top-0 z-10">
                        <FileText className="h-3.5 w-3.5" />
                        筆記
                        <span className="text-muted-foreground/60">({notes.length})</span>
                      </div>
                      {notes.map(renderItemCard)}
                    </>
                  )}
                  {todos.length > 0 && (
                    <>
                      <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/50 sticky top-0 z-10">
                        <ListTodo className="h-3.5 w-3.5" />
                        待辦
                        <span className="text-muted-foreground/60">({todos.length})</span>
                      </div>
                      {todos.map(renderItemCard)}
                    </>
                  )}
                  {scratches.length > 0 && (
                    <>
                      <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/50 sticky top-0 z-10">
                        <StickyNote className="h-3.5 w-3.5" />
                        暫存
                        <span className="text-muted-foreground/60">({scratches.length})</span>
                      </div>
                      {scratches.map(renderItemCard)}
                    </>
                  )}
                </>
              );
            })()
          : state.categoryGroups
            ? state.categoryGroups.map((group) => (
                <div key={group.key}>
                  <div
                    data-testid="category-group-header"
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/50 sticky top-0 z-10 cursor-pointer select-none hover:bg-muted/80"
                    onClick={() => state.toggleCategoryCollapse(group.key)}
                  >
                    {state.collapsedCategories.has(group.key) ? (
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
                  {!state.collapsedCategories.has(group.key) && group.items.map(renderItemCard)}
                </div>
              ))
            : state.items.map(renderItemCard)}
        {state.total > state.offset + state.limit && (
          <button
            className="w-full py-3 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => state.setOffset((o) => o + state.limit)}
          >
            載入更多...
          </button>
        )}
      </div>
    </div>
  );
}
