import { Badge } from "@/components/ui/badge";
import { updateItem } from "@/lib/api";
import type { ParsedItem, ItemStatus } from "@/lib/types";
import { toast } from "sonner";
import {
  Square,
  CheckSquare,
  Sparkles,
  Pencil,
  Gem,
  ExternalLink,
  PlayCircle,
  Check,
  Archive,
} from "lucide-react";

const priorityColors: Record<string, string> = {
  high: "border-l-red-500",
  medium: "border-l-yellow-500",
  low: "border-l-blue-500",
};

const statusConfig: Record<ItemStatus, { label: string; color: string; icon: React.ReactNode }> = {
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
  done: {
    label: "已完成",
    color: "text-muted-foreground",
    icon: <Check className="h-3 w-3" />,
  },
  archived: {
    label: "已封存",
    color: "text-muted-foreground",
    icon: <Archive className="h-3 w-3" />,
  },
};

function getDueDateInfo(dueDate: string): { label: string; className: string } {
  const today = new Date().toISOString().split("T")[0]!;
  const diffDays = Math.ceil(
    (new Date(dueDate).getTime() - new Date(today).getTime()) / 86400000
  );

  if (diffDays < 0) {
    return {
      label: `已過期 ${Math.abs(diffDays)} 天`,
      className: "text-red-500",
    };
  }
  if (diffDays === 0) {
    return { label: "今天到期", className: "text-orange-500" };
  }
  if (diffDays === 1) {
    return {
      label: "明天",
      className: "text-yellow-600 dark:text-yellow-400",
    };
  }
  if (diffDays <= 7) {
    return { label: `剩 ${diffDays} 天`, className: "text-muted-foreground" };
  }
  return { label: dueDate, className: "text-muted-foreground" };
}

interface ItemCardProps {
  item: ParsedItem;
  selected?: boolean;
  onSelect?: (item: ParsedItem) => void;
  onUpdated?: () => void;
  selectionMode?: boolean;
  checked?: boolean;
  onToggle?: (id: string) => void;
}

export function ItemCard({
  item,
  selected,
  onSelect,
  onUpdated,
  selectionMode,
  checked,
  onToggle,
}: ItemCardProps) {
  const borderColor = item.priority
    ? priorityColors[item.priority] ?? ""
    : "";

  const dueDateInfo = item.due ? getDueDateInfo(item.due) : null;
  const isOverdue =
    dueDateInfo?.className === "text-red-500" && item.status !== "done";

  const status = statusConfig[item.status];

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

  const handleClick = () => {
    if (selectionMode) {
      onToggle?.(item.id);
    } else {
      onSelect?.(item);
    }
  };

  return (
    <div
      className={`p-3 border-l-4 cursor-pointer transition-colors hover:bg-accent ${borderColor} ${
        selected && !selectionMode ? "bg-accent" : ""
      } ${checked ? "bg-accent/50" : ""} ${item.status === "done" ? "opacity-60" : ""} ${isOverdue ? "ring-1 ring-red-200 dark:ring-red-900" : ""}`}
      onClick={handleClick}
    >
      <div className="flex items-start gap-2">
        {selectionMode && (
          <button
            className="mt-0.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.(item.id);
            }}
          >
            {checked ? (
              <CheckSquare className="h-4 w-4" />
            ) : (
              <Square className="h-4 w-4" />
            )}
          </button>
        )}
        {!selectionMode && item.type === "todo" && (
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
            {status && (
              <Badge variant="outline" className={`text-xs gap-0.5 ${status.color}`}>
                {status.icon}
                {status.label}
              </Badge>
            )}
            {item.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {dueDateInfo && (
              <span className={`text-xs ${dueDateInfo.className}`}>
                {dueDateInfo.label}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
