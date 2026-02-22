import { useEffect, useState, useCallback } from "react";
import { listItems } from "@/lib/api";
import { parseItems, type ParsedItem, type ItemStatus } from "@/lib/types";
import { ItemCard } from "./item-card";
import { toast } from "sonner";
import { Loader2, Inbox } from "lucide-react";

interface ItemListProps {
  status?: ItemStatus;
  tag?: string;
  selectedId?: string;
  onSelect?: (item: ParsedItem) => void;
  refreshKey?: number;
}

export function ItemList({
  status,
  tag,
  selectedId,
  onSelect,
  refreshKey,
}: ItemListProps) {
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listItems({ status, tag, limit, offset });
      setItems(parseItems(res.items));
      setTotal(res.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, [status, tag, offset, refreshKey]);

  useEffect(() => {
    setOffset(0);
  }, [status, tag]);

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
  );
}
