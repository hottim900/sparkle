import { useEffect, useState, useCallback } from "react";
import { listItems } from "@/lib/api";
import { parseItems, type ParsedItem, type ItemStatus, type ItemType } from "@/lib/types";
import { ItemCard } from "./item-card";
import { toast } from "sonner";
import { Loader2, Inbox, ArrowUpDown } from "lucide-react";

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
  const limit = 50;

  const currentSort = sortOptions[sortIdx];

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listItems({
        status,
        type,
        tag,
        sort: currentSort.sort,
        order: currentSort.order,
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
      </div>
      <div className="divide-y">
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            onSelect={onSelect}
            onUpdated={fetchItems}
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
