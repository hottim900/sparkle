import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getStats, getFocus, listItems } from "@/lib/api";
import { parseItems, type ParsedItem, type StatsResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  TrendingUp,
  Inbox,
  AlertTriangle,
  Target,
  ChevronRight,
  LayoutDashboard,
  Loader2,
} from "lucide-react";

interface DashboardProps {
  onViewChange: (view: "inbox") => void;
  onSelectItem: (item: ParsedItem) => void;
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

function formatDueDate(dueDate: string): string {
  const date = new Date(dueDate);
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

export function Dashboard({ onViewChange, onSelectItem }: DashboardProps) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [focusItems, setFocusItems] = useState<ParsedItem[]>([]);
  const [recentDone, setRecentDone] = useState<ParsedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [statsRes, focusRes, doneRes] = await Promise.all([
          getStats(),
          getFocus(),
          listItems({
            status: "done",
            sort: "created_at",
            order: "desc",
            limit: 10,
          }),
        ]);

        if (cancelled) return;

        setStats(statsRes);
        setFocusItems(parseItems(focusRes.items).slice(0, 5));
        setRecentDone(parseItems(doneRes.items));
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

        {/* Section 1: Achievement Summary */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">
              完成摘要
            </h2>
          </div>

          {/* Number cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="border rounded-lg p-4 text-center">
              <p className="text-2xl font-bold">
                {stats.completed_this_week}
              </p>
              <p className="text-xs text-muted-foreground">本週完成</p>
            </div>
            <div className="border rounded-lg p-4 text-center">
              <p className="text-2xl font-bold">
                {stats.completed_this_month}
              </p>
              <p className="text-xs text-muted-foreground">本月完成</p>
            </div>
          </div>

          {/* Recently completed items */}
          {recentDone.length > 0 && (
            <div className="space-y-1">
              {recentDone.map((item) => (
                <button
                  key={item.id}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm hover:bg-accent transition-colors"
                  onClick={() => onSelectItem(item)}
                >
                  <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                  <span className="truncate">{item.title}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Section 2: Today's Focus */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">
              今日焦點
            </h2>
          </div>

          {focusItems.length === 0 ? (
            <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
              沒有緊急項目，做得好！
            </div>
          ) : (
            <div className="space-y-2">
              {focusItems.map((item) => {
                const overdue = isOverdue(item.due_date);
                return (
                  <button
                    key={item.id}
                    className={`w-full border rounded-lg p-3 text-left hover:bg-accent transition-colors ${
                      overdue
                        ? "border-red-300 dark:border-red-800"
                        : ""
                    }`}
                    onClick={() => onSelectItem(item)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium truncate flex-1">
                        {item.title}
                      </span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {item.priority && (
                          <Badge variant={priorityVariant(item.priority)}>
                            {priorityLabel(item.priority)}
                          </Badge>
                        )}
                        {item.status === "inbox" && (
                          <Badge variant="outline">
                            <Inbox className="h-3 w-3 mr-1" />
                            收件匣
                          </Badge>
                        )}
                      </div>
                    </div>
                    {item.due_date && (
                      <p
                        className={`text-xs mt-1 ${
                          overdue
                            ? "text-red-500"
                            : "text-muted-foreground"
                        }`}
                      >
                        {overdue ? "已逾期 - " : "到期日 "}
                        {formatDueDate(item.due_date)}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Section 3: Inbox Health */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">
              收件匣健康度
            </h2>
          </div>

          <div
            className={`border rounded-lg p-6 text-center space-y-2 ${
              stats.inbox_count === 0
                ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950"
                : stats.inbox_count > 10
                  ? "border-yellow-300 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950"
                  : ""
            }`}
          >
            <p className="text-3xl font-bold">{stats.inbox_count}</p>
            <p className="text-sm text-muted-foreground">
              {stats.inbox_count === 0
                ? "收件匣已清空！"
                : stats.inbox_count <= 10
                  ? "收件匣狀態良好"
                  : `收件匣有 ${stats.inbox_count} 筆待整理`}
            </p>
            {stats.inbox_count > 10 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => onViewChange("inbox")}
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
      </div>
    </div>
  );
}
