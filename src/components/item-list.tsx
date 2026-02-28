import { useEffect, useState, useCallback } from "react";
import { listItems, batchAction } from "@/lib/api";
import { useAppContext } from "@/lib/app-context";
import {
  parseItems,
  type ParsedItem,
  type ItemStatus,
  type ItemType,
  type ViewType,
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

type NoteSubView = "fleeting" | "developing" | "permanent" | "exported";
type TodoSubView = "active" | "done";

const noteChips: { id: NoteSubView; label: string }[] = [
  { id: "fleeting", label: "閃念" },
  { id: "developing", label: "發展中" },
  { id: "permanent", label: "永久筆記" },
  { id: "exported", label: "已匯出" },
];

const todoChips: { id: TodoSubView; label: string }[] = [
  { id: "active", label: "進行中" },
  { id: "done", label: "已完成" },
];

// Batch actions per view context
type BatchActionConfig = {
  action: string;
  label: string;
  icon: React.ReactNode;
  variant?: "destructive" | "ghost";
  confirm?: string;
};

function getBatchActions(
  view: ViewType,
  subView?: string,
  obsidianEnabled?: boolean,
): BatchActionConfig[] {
  const effectiveView = subView ?? view;
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

  switch (effectiveView) {
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
  selectedId?: string;
  noteSubView?: NoteSubView;
  todoSubView?: TodoSubView;
  onNoteSubViewChange?: (v: NoteSubView) => void;
  onTodoSubViewChange?: (v: TodoSubView) => void;
}

export function ItemList({
  status,
  type,
  selectedId,
  noteSubView,
  todoSubView,
  onNoteSubViewChange,
  onTodoSubViewChange,
}: ItemListProps) {
  const {
    currentView,
    selectedTag: tag,
    onSelectItem: onSelect,
    onNavigate,
    refreshKey,
    obsidianEnabled,
  } = useAppContext();
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sortIdx, setSortIdx] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const limit = 50;

  const noteViews = ["notes", "fleeting", "developing", "permanent", "exported"];
  const todoViews = ["todos", "active", "done"];
  const scratchViews = ["scratch", "draft"];
  const isNoteView = currentView ? noteViews.includes(currentView) : false;
  const isTodoView = currentView ? todoViews.includes(currentView) : false;
  const isScratchView = currentView ? scratchViews.includes(currentView) : false;
  const sortOptions =
    isNoteView || isScratchView ? baseSortOptions : [...baseSortOptions, dueSortOption];
  const defaultSortIdx = isTodoView ? sortOptions.length - 1 : 0; // todos default to due date
  const safeSortIdx = sortIdx < sortOptions.length ? sortIdx : defaultSortIdx;
  const currentSort = sortOptions[safeSortIdx];

  // Determine effective status and type from view + sub-navigation
  const effectiveStatus: ItemStatus | undefined = (() => {
    if (currentView === "notes" && noteSubView) return noteSubView;
    if (currentView === "todos" && todoSubView) return todoSubView;
    if (currentView === "scratch") return "draft";
    return status;
  })();

  const effectiveType: ItemType | undefined = (() => {
    if (currentView === "notes") return "note";
    if (currentView === "todos") return "todo";
    if (currentView === "scratch") return "scratch";
    return type;
  })();

  // For views that exclude archived
  const excludeStatus: string[] | undefined = (() => {
    if (currentView === "notes" && !noteSubView) return ["archived"];
    if (currentView === "todos" && !todoSubView) return ["archived"];
    return undefined;
  })();
  const excludeStatusKey = excludeStatus?.join() ?? "";

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listItems({
        status: effectiveStatus,
        type: effectiveType,
        tag,
        sort: currentSort?.sort ?? "created",
        order: currentSort?.order ?? "desc",
        limit,
        offset,
        excludeStatus,
      });
      setItems(parseItems(res.items));
      setTotal(res.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- excludeStatus is a new array each render; excludeStatusKey captures its value stably
  }, [
    effectiveStatus,
    effectiveType,
    tag,
    offset,
    refreshKey,
    currentSort?.sort,
    currentSort?.order,
    excludeStatusKey,
  ]);

  // Reset sort to view-appropriate default when switching views
  useEffect(() => {
    if (isScratchView) {
      setSortIdx(2); // "最近更新" (index 2 in baseSortOptions)
    } else if (isTodoView) {
      setSortIdx(sortOptions.length - 1);
    } else {
      setSortIdx(0);
    }
  }, [currentView, isScratchView, isTodoView, sortOptions.length]);

  useEffect(() => {
    setOffset(0);
  }, [effectiveStatus, effectiveType, tag, safeSortIdx]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

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

  const handleBatchAction = async (config: BatchActionConfig) => {
    if (selectedIds.size === 0) return;

    if (config.confirm) {
      const confirmed = window.confirm(
        config.confirm.replace("所選項目", `所選的 ${selectedIds.size} 個項目`),
      );
      if (!confirmed) return;
    }

    try {
      const result = await batchAction(Array.from(selectedIds), config.action);
      const skippedMsg = result.skipped > 0 ? `，跳過 ${result.skipped} 筆` : "";

      if (config.action === "export" && result.errors && result.errors.length > 0) {
        toast.warning(
          `匯出 ${result.affected} 筆成功，${result.errors.length} 筆失敗${skippedMsg}`,
        );
      } else {
        toast.success(`已${config.label} ${result.affected} 個項目${skippedMsg}`);
      }
      exitSelectionMode();
      fetchItems();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批次操作失敗");
    }
  };

  const activeSubView =
    currentView === "notes" ? noteSubView : currentView === "todos" ? todoSubView : undefined;
  const batchActions = getBatchActions(currentView ?? "all", activeSubView, obsidianEnabled);

  if (loading && items.length === 0) {
    return (
      <>
        {renderSubNav()}
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </>
    );
  }

  function renderSubNav() {
    if (currentView === "notes") {
      return (
        <div className="flex gap-1 px-3 py-2 border-b overflow-x-auto">
          {noteChips.map((chip) => (
            <Button
              key={chip.id}
              size="sm"
              variant={noteSubView === chip.id ? "default" : "outline"}
              className="h-7 text-xs shrink-0"
              onClick={() => onNoteSubViewChange?.(chip.id)}
            >
              {chip.label}
            </Button>
          ))}
        </div>
      );
    }
    if (currentView === "todos") {
      return (
        <div className="flex gap-1 px-3 py-2 border-b overflow-x-auto">
          {todoChips.map((chip) => (
            <Button
              key={chip.id}
              size="sm"
              variant={todoSubView === chip.id ? "default" : "outline"}
              className="h-7 text-xs shrink-0"
              onClick={() => onTodoSubViewChange?.(chip.id)}
            >
              {chip.label}
            </Button>
          ))}
        </div>
      );
    }
    return null;
  }

  if (items.length === 0) {
    return (
      <>
        {renderSubNav()}
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Inbox className="h-10 w-10 mb-2" />
          <p className="text-sm">沒有項目</p>
        </div>
      </>
    );
  }

  return (
    <div>
      {renderSubNav()}
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
          >
            <CheckSquare className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      <div className="divide-y">
        {currentView === "all" || currentView === "archived"
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
                          onSelect={onSelect}
                          onNavigate={onNavigate}
                          onUpdated={fetchItems}
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
                          onSelect={onSelect}
                          onNavigate={onNavigate}
                          onUpdated={fetchItems}
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
                          onSelect={onSelect}
                          onNavigate={onNavigate}
                          onUpdated={fetchItems}
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
          : items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onSelect={onSelect}
                onNavigate={onNavigate}
                onUpdated={fetchItems}
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
