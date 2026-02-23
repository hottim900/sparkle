import { useEffect, useState, useCallback } from "react";
import { listItems, batchAction } from "@/lib/api";
import { parseItems, type ParsedItem, type ItemStatus, type ItemType } from "@/lib/types";
import { ItemCard } from "./item-card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, Inbox, ArrowUpDown, CheckSquare, Archive, CheckCircle, Trash2 } from "lucide-react";

type SortOption = {
  label: string;
  sort: string;
  order: string;
};

const sortOptions: SortOption[] = [
  { label: "最新建立", sort: "created_at", order: "desc" },
  { label: "最舊建立", sort: "created_at", order: "asc" },
  { label: "優先度高→低", sort: "priority", order: "desc" },
  { label: "到期日近→遠", sort: "due_date", order: "asc" },
];

interface ItemListProps {
  status?: ItemStatus;
  type?: ItemType;
  tag?: string;
  selectedId?: string;
  onSelect?: (item: ParsedItem) => void;
  refreshKey?: number;
}

export function ItemList({
  status,
  type,
  tag,
  selectedId,
  onSelect,
  refreshKey,
}: ItemListProps) {
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sortIdx, setSortIdx] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const limit = 50;

  const currentSort = sortOptions[sortIdx];

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listItems({
        status,
        type,
        tag,
        sort: currentSort?.sort ?? "created_at",
        order: currentSort?.order ?? "desc",
        limit,
        offset,
      });
      setItems(parseItems(res.items));
      setTotal(res.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, [status, type, tag, offset, refreshKey, sortIdx]);

  useEffect(() => {
    setOffset(0);
  }, [status, type, tag, sortIdx]);

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

  const handleBatchAction = async (action: "archive" | "done" | "active" | "delete") => {
    if (selectedIds.size === 0) return;

    if (action === "delete") {
      const confirmed = window.confirm(`確定要刪除所選的 ${selectedIds.size} 個項目嗎？此操作無法復原。`);
      if (!confirmed) return;
    }

    try {
      const result = await batchAction(Array.from(selectedIds), action);
      const actionLabels = { archive: "封存", done: "完成", active: "啟用", delete: "刪除" };
      toast.success(`已${actionLabels[action]} ${result.affected} 個項目`);
      exitSelectionMode();
      fetchItems();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批次操作失敗");
    }
  };

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
          <span className="text-sm text-muted-foreground">
            已選 {selectedIds.size} 項
          </span>
          <div className="flex-1" />
          <Button variant="ghost" size="xs" onClick={toggleSelectAll}>
            {selectedIds.size === items.length ? "取消全選" : "全選"}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => handleBatchAction("active")}>
            <CheckCircle className="h-3.5 w-3.5" />
            啟用
          </Button>
          <Button variant="ghost" size="xs" onClick={() => handleBatchAction("done")}>
            <CheckSquare className="h-3.5 w-3.5" />
            完成
          </Button>
          <Button variant="ghost" size="xs" onClick={() => handleBatchAction("archive")}>
            <Archive className="h-3.5 w-3.5" />
            封存
          </Button>
          <Button variant="destructive" size="xs" onClick={() => handleBatchAction("delete")}>
            <Trash2 className="h-3.5 w-3.5" />
            刪除
          </Button>
          <Button variant="ghost" size="xs" onClick={exitSelectionMode}>
            取消
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            className="text-sm bg-transparent text-muted-foreground outline-none cursor-pointer"
            value={sortIdx}
            onChange={(e) => setSortIdx(Number(e.target.value))}
          >
            {sortOptions.map((opt, i) => (
              <option key={i} value={i}>
                {opt.label}
              </option>
            ))}
          </select>
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
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            onSelect={onSelect}
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
