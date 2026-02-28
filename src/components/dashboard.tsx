import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getStats, getFocus } from "@/lib/api";
import { parseItems, type ParsedItem, type StatsResponse } from "@/lib/types";
import { useAppContext } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  Sparkles,
  AlertTriangle,
  Target,
  ChevronRight,
  LayoutDashboard,
  Loader2,
  Gem,
  Pencil,
  CheckCircle,
  StickyNote,
} from "lucide-react";

interface DashboardProps {
  onSelectItem: (item: ParsedItem) => void;
}

function isOverdue(due: string | null): boolean {
  if (!due) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(due);
  dueDate.setHours(0, 0, 0, 0);
  return dueDate < today;
}

function formatDueDate(due: string): string {
  const date = new Date(due);
  return date.toLocaleDateString("zh-TW", {
    month: "short",
    day: "numeric",
  });
}

function priorityLabel(priority: string | null): string {
  switch (priority) {
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
    default:
      return "";
  }
}

function priorityVariant(
  priority: string | null,
): "destructive" | "default" | "secondary" | "outline" {
  switch (priority) {
    case "high":
      return "destructive";
    case "medium":
      return "default";
    case "low":
      return "secondary";
    default:
      return "outline";
  }
}

export function Dashboard({ onSelectItem }: DashboardProps) {
  const { onViewChange } = useAppContext();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [focusItems, setFocusItems] = useState<ParsedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [statsRes, focusRes] = await Promise.all([getStats(), getFocus()]);

        if (cancelled) return;

        setStats(statsRes);
        setFocusItems(parseItems(focusRes.items).slice(0, 5));
      } catch {
        if (!cancelled) {
          toast.error("無法載入總覽資料");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
      <div className="max-w-2xl mx-auto p-4 space-y-6">
        {/* Page title */}
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-5 w-5" />
          <h1 className="text-xl font-bold">總覽</h1>
        </div>

        {/* Section 1: Zettelkasten Progress */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">知識庫進度</h2>
          </div>

          {/* Number cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="border rounded-lg p-4 text-center">
              <p className="text-2xl font-bold">{stats.exported_this_week}</p>
              <p className="text-xs text-muted-foreground">本週匯出</p>
            </div>
            <div className="border rounded-lg p-4 text-center">
              <p className="text-2xl font-bold">{stats.exported_this_month}</p>
              <p className="text-xs text-muted-foreground">本月匯出</p>
            </div>
          </div>

          {/* Note maturity stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="border rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-green-600 dark:text-green-400">
                <Gem className="h-3.5 w-3.5" />
                <p className="text-lg font-bold">{stats.permanent_count}</p>
              </div>
              <p className="text-xs text-muted-foreground">永久筆記</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-blue-600 dark:text-blue-400">
                <Pencil className="h-3.5 w-3.5" />
                <p className="text-lg font-bold">{stats.developing_count}</p>
              </div>
              <p className="text-xs text-muted-foreground">發展中</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground">
                <CheckCircle className="h-3.5 w-3.5" />
                <p className="text-lg font-bold">{stats.done_this_week}</p>
              </div>
              <p className="text-xs text-muted-foreground">本週完成</p>
            </div>
          </div>
        </section>

        {/* Section 2: Today's Focus */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">今日焦點</h2>
          </div>

          {focusItems.length === 0 ? (
            <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
              沒有緊急項目，做得好！
            </div>
          ) : (
            <div className="space-y-2">
              {focusItems.map((item) => {
                const overdue = isOverdue(item.due);
                return (
                  <button
                    key={item.id}
                    className={`w-full border rounded-lg p-3 text-left hover:bg-accent transition-colors ${
                      overdue ? "border-red-300 dark:border-red-800" : ""
                    }`}
                    onClick={() => onSelectItem(item)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium truncate flex-1">{item.title}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {item.priority && (
                          <Badge variant={priorityVariant(item.priority)}>
                            {priorityLabel(item.priority)}
                          </Badge>
                        )}
                        {item.status === "fleeting" && (
                          <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
                            <Sparkles className="h-3 w-3 mr-1" />
                            閃念
                          </Badge>
                        )}
                      </div>
                    </div>
                    {item.due && (
                      <p
                        className={`text-xs mt-1 ${
                          overdue ? "text-red-500" : "text-muted-foreground"
                        }`}
                      >
                        {overdue ? "已逾期 - " : "到期日 "}
                        {formatDueDate(item.due)}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Section 3: Fleeting Health */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">閃念健康度</h2>
          </div>

          <div
            className={`border rounded-lg p-6 text-center space-y-2 ${
              stats.fleeting_count === 0
                ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950"
                : stats.fleeting_count > 10
                  ? "border-yellow-300 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950"
                  : ""
            }`}
          >
            <p className="text-3xl font-bold">{stats.fleeting_count}</p>
            <p className="text-sm text-muted-foreground">
              {stats.fleeting_count === 0
                ? "閃念筆記已清空！"
                : stats.fleeting_count <= 10
                  ? "閃念筆記狀態良好"
                  : `有 ${stats.fleeting_count} 筆閃念待整理`}
            </p>
            {stats.fleeting_count > 10 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => onViewChange("notes")}
              >
                開始整理
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {stats.overdue_count > 0 && (
              <div className="flex items-center justify-center gap-1 text-sm text-red-500 pt-2">
                <AlertTriangle className="h-4 w-4" />
                <span>{stats.overdue_count} 筆已逾期</span>
              </div>
            )}
          </div>
        </section>

        {/* Section 4: Scratch count (only show if there are scratch items) */}
        {stats.scratch_count > 0 && (
          <section>
            <button
              className="w-full border rounded-lg p-4 flex items-center justify-between hover:bg-accent transition-colors"
              onClick={() => onViewChange("scratch")}
            >
              <div className="flex items-center gap-2">
                <StickyNote className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-medium">暫存區</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold">{stats.scratch_count}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
