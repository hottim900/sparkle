import { Badge } from "@/components/ui/badge";
import { updateItem } from "@/lib/api";
import type { ParsedItem } from "@/lib/types";
import { toast } from "sonner";
import { Square, CheckSquare } from "lucide-react";

const priorityColors: Record<string, string> = {
  high: "border-l-red-500",
  medium: "border-l-yellow-500",
  low: "border-l-blue-500",
};

interface ItemCardProps {
  item: ParsedItem;
  selected?: boolean;
  onSelect?: (item: ParsedItem) => void;
  onUpdated?: () => void;
}

export function ItemCard({
  item,
  selected,
  onSelect,
  onUpdated,
}: ItemCardProps) {
  const borderColor = item.priority
    ? priorityColors[item.priority] ?? ""
    : "";

  const handleToggleDone = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await updateItem(item.id, {
        status: item.status === "done" ? "active" : "done",
      });
      onUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失敗");
    }
  };

  return (
    <div
      className={`p-3 border-l-4 cursor-pointer transition-colors hover:bg-accent ${borderColor} ${
        selected ? "bg-accent" : ""
      } ${item.status === "done" ? "opacity-60" : ""}`}
      onClick={() => onSelect?.(item)}
    >
      <div className="flex items-start gap-2">
        {item.type === "todo" && (
          <button
            onClick={handleToggleDone}
            className="mt-0.5 text-muted-foreground hover:text-foreground"
          >
            {item.status === "done" ? (
              <CheckSquare className="h-4 w-4" />
            ) : (
              <Square className="h-4 w-4" />
            )}
          </button>
        )}
        <div className="flex-1 min-w-0">
          <p
            className={`text-sm font-medium truncate ${
              item.status === "done" ? "line-through" : ""
            }`}
          >
            {item.title}
          </p>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {item.type === "todo" && (
              <Badge variant="outline" className="text-xs">
                待辦
              </Badge>
            )}
            {item.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {item.due_date && (
              <span className="text-xs text-muted-foreground">
                {item.due_date}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
