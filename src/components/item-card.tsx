import { Badge } from "@/components/ui/badge";
import { updateItem, deleteItem } from "@/lib/api";
import type { ParsedItem } from "@/lib/types";
import { toast } from "sonner";
import { Square, CheckSquare, FileText, ListTodo, Trash2, Link, Globe } from "lucide-react";

const priorityColors: Record<string, string> = {
  high: "border-l-red-500",
  medium: "border-l-yellow-500",
  low: "border-l-blue-500",
};

function getDueDateInfo(dueDate: string): { label: string; className: string } {
  const today = new Date().toISOString().split("T")[0]!;
  const diffDays = Math.ceil((new Date(dueDate).getTime() - new Date(today).getTime()) / 86400000);

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
  onNavigate?: (itemId: string) => void;
  onUpdated?: () => void;
  selectionMode?: boolean;
  checked?: boolean;
  onToggle?: (id: string) => void;
}

export function ItemCard({
  item,
  selected,
  onSelect,
  onNavigate,
  onUpdated,
  selectionMode,
  checked,
  onToggle,
}: ItemCardProps) {
  const borderColor = item.priority ? (priorityColors[item.priority] ?? "") : "";

  const dueDateInfo = item.type === "todo" && item.due ? getDueDateInfo(item.due) : null;
  const isOverdue = dueDateInfo?.className === "text-red-500" && item.status !== "done";

  const handleScratchDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const hasContent = item.content && item.content.trim().length > 0;
    if (hasContent) {
      const confirmed = window.confirm(`確定要刪除「${item.title}」嗎？`);
      if (!confirmed) return;
    }
    try {
      await deleteItem(item.id);
      onUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刪除失敗");
    }
  };

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
            {checked ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
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
        {!selectionMode && item.type === "scratch" && (
          <button
            onClick={handleScratchDelete}
            className="mt-0.5 text-muted-foreground hover:text-destructive"
            title="刪除"
          >
            <Trash2 className="h-4 w-4" />
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
            {item.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {item.type === "todo" && item.linked_note_id && item.linked_note_title && (
              <button
                type="button"
                className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors max-w-[120px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigate?.(item.linked_note_id!);
                }}
                title={item.linked_note_title}
              >
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate">{item.linked_note_title}</span>
              </button>
            )}
            {item.type === "note" && item.linked_todo_count > 0 && (
              <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                <ListTodo className="h-3 w-3 shrink-0" />
                {item.linked_todo_count} 待辦
              </span>
            )}
            {item.type === "note" && item.share_visibility && (
              <span
                className="inline-flex items-center text-xs"
                title={item.share_visibility === "public" ? "已公開分享" : "已建立分享連結"}
              >
                {item.share_visibility === "public" ? (
                  <Globe className="h-3 w-3 shrink-0 text-blue-500 dark:text-blue-400" />
                ) : (
                  <Link className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
              </span>
            )}
            {dueDateInfo && (
              <span className={`text-xs ${dueDateInfo.className}`}>{dueDateInfo.label}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
