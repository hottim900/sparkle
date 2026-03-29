import { useCallback, useMemo } from "react";
import { useNavigate, useRouterState, type NavigateOptions } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listItems, updateItem } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { parseItems, type ParsedItem } from "@/lib/types";
import { useAppContext } from "@/lib/app-context";
import { useInvalidateAfterItemMutation } from "@/hooks/use-invalidate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  PauseCircle,
  Play,
  FileText,
  ListTodo,
  StickyNote,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

function getDaysPaused(paused_at: string | null): number {
  if (!paused_at) return 0;
  const now = new Date();
  const paused = new Date(paused_at);
  return Math.floor((now.getTime() - paused.getTime()) / 86400000);
}

function getTypeBadge(type: string) {
  switch (type) {
    case "note":
      return (
        <Badge variant="secondary" className="text-xs gap-0.5">
          <FileText className="h-3 w-3" />
          筆記
        </Badge>
      );
    case "todo":
      return (
        <Badge variant="secondary" className="text-xs gap-0.5">
          <ListTodo className="h-3 w-3" />
          待辦
        </Badge>
      );
    case "scratch":
      return (
        <Badge variant="secondary" className="text-xs gap-0.5">
          <StickyNote className="h-3 w-3" />
          暫存
        </Badge>
      );
    default:
      return null;
  }
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    fleeting: "閃念",
    developing: "發展中",
    permanent: "永久筆記",
    exported: "已匯出",
    active: "進行中",
    done: "已完成",
    draft: "暫存",
    archived: "已封存",
  };
  return labels[status] ?? status;
}

export function PausedItemList() {
  const { isOnline } = useAppContext();
  const navigate = useNavigate();
  const invalidateAfterSave = useInvalidateAfterItemMutation();

  const selectedId = useRouterState({
    select: (s) => {
      const search = s.location.search as Record<string, unknown>;
      return typeof search.item === "string" ? search.item : undefined;
    },
  });

  const {
    data: itemsData,
    isPending,
    error: itemsError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.items.list({ paused: "true", sort: "created", order: "asc", limit: 100 }),
    queryFn: () => listItems({ paused: "true", sort: "created", order: "asc", limit: 100 }),
  });

  const items = useMemo(() => parseItems(itemsData?.items ?? []), [itemsData?.items]);

  const notes = useMemo(() => items.filter((i) => i.type === "note"), [items]);
  const todos = useMemo(() => items.filter((i) => i.type === "todo"), [items]);
  const scratches = useMemo(() => items.filter((i) => i.type === "scratch"), [items]);

  const handleResume = useCallback(
    async (item: ParsedItem) => {
      try {
        await updateItem(item.id, { paused: false });
        invalidateAfterSave("paused");
        toast.success("已恢復");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "恢復失敗");
      }
    },
    [invalidateAfterSave],
  );

  const navigateToItem = useCallback(
    (itemId: string) => {
      navigate({
        search: (prev) => ({ ...prev, item: itemId }),
      } as NavigateOptions);
    },
    [navigate],
  );

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
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground px-6">
        <PauseCircle className="h-10 w-10 mb-2" />
        <p className="text-sm text-center">
          目前沒有暫停中的項目。暫停功能讓你擱置暫時無法處理的筆記和待辦，不觸發 stale 警告。
        </p>
      </div>
    );
  }

  const renderItem = (item: ParsedItem) => {
    const daysPaused = getDaysPaused(item.paused_at);

    return (
      <div
        key={item.id}
        className={`p-3 border-l-4 border-l-amber-300 dark:border-l-amber-700 cursor-pointer transition-colors hover:bg-accent ${
          selectedId === item.id ? "bg-accent" : ""
        }`}
        onClick={() => navigateToItem(item.id)}
      >
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-medium truncate">{item.title}</p>
              {getTypeBadge(item.type)}
              <Badge variant="outline" className="text-xs">
                {getStatusLabel(item.status)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground italic mt-1 line-clamp-2">
              {item.paused_context || "未附備忘"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground whitespace-nowrap">{daysPaused} 天</span>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                handleResume(item);
              }}
              disabled={!isOnline}
            >
              <Play className="h-3 w-3" />
              恢復
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderGroup = (label: string, icon: React.ReactNode, groupItems: ParsedItem[]) => {
    if (groupItems.length === 0) return null;
    return (
      <>
        <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/50 sticky top-0 z-10">
          {icon}
          {label}
          <span className="text-muted-foreground/60">({groupItems.length})</span>
        </div>
        {groupItems.map(renderItem)}
      </>
    );
  };

  return (
    <div className="divide-y">
      {renderGroup("筆記", <FileText className="h-3.5 w-3.5" />, notes)}
      {renderGroup("待辦", <ListTodo className="h-3.5 w-3.5" />, todos)}
      {renderGroup("暫存", <StickyNote className="h-3.5 w-3.5" />, scratches)}
    </div>
  );
}
