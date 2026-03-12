import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { getStats, getFocus, getStaleNotes, getCategoryDistribution } from "@/lib/api";
import { parseItems } from "@/lib/types";
import { queryKeys } from "@/lib/query-keys";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  Target,
  TrendingUp,
  AlertTriangle,
  ChevronRight,
  Sparkles,
  Clock,
  Loader2,
} from "lucide-react";

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

export function Dashboard() {
  const navigate = useNavigate();

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
  } = useQuery({
    queryKey: queryKeys.stats,
    queryFn: getStats,
  });

  const { data: focusItems = [], isLoading: focusLoading } = useQuery({
    queryKey: queryKeys.focus,
    queryFn: () => getFocus().then((r) => parseItems(r.items).slice(0, 5)),
  });

  const { data: staleItems = [], isLoading: staleLoading } = useQuery({
    queryKey: queryKeys.stale,
    queryFn: () => getStaleNotes().then((r) => r.items),
  });

  const { data: categoryDist = [], isLoading: categoryLoading } = useQuery({
    queryKey: queryKeys.categoryDistribution,
    queryFn: () => getCategoryDistribution().then((r) => r.distribution),
  });

  useEffect(() => {
    if (statsError) toast.error("無法載入總覽資料");
  }, [statsError]);

  if (statsLoading || focusLoading || staleLoading || categoryLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) return null;

  const hasAttentionItems = focusItems.length > 0 || staleItems.length > 0;
  const maxCategoryCount = Math.max(...categoryDist.map((d) => d.count), 1);

  return (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="max-w-2xl mx-auto p-4 space-y-6">
        {/* Page title */}
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-5 w-5" />
          <h1 className="text-xl font-bold">總覽</h1>
        </div>

        {/* Section 1: Needs Attention */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">需要關注</h2>
          </div>

          {!hasAttentionItems ? (
            <div className="border rounded-lg p-6 text-center text-sm text-muted-foreground">
              沒有需要關注的項目，做得好！
            </div>
          ) : (
            <div className="space-y-2">
              {/* Focus items */}
              {focusItems.map((item) => {
                const overdue = isOverdue(item.due);
                return (
                  <button
                    key={item.id}
                    className={`w-full border rounded-lg p-3 text-left hover:bg-accent transition-colors ${
                      overdue ? "border-red-300 dark:border-red-800" : ""
                    }`}
                    onClick={() => navigate({ to: "/all", search: { item: item.id } })}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium truncate flex-1">{item.title}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {item.priority && (
                          <Badge variant={priorityVariant(item.priority)}>
                            {priorityLabel(item.priority)}
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

              {/* Stale notes */}
              {staleItems.map((item) => (
                <button
                  key={item.id}
                  className="w-full border rounded-lg p-3 text-left hover:bg-accent transition-colors"
                  onClick={() => navigate({ to: "/all", search: { item: item.id } })}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium truncate flex-1">{item.title}</span>
                    <Badge variant="outline" className="text-amber-600 dark:text-amber-400">
                      <Clock className="h-3 w-3 mr-1" />
                      {item.days_stale} 天未更新
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Section 2: Zettelkasten Pipeline */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">Zettelkasten 管道</h2>
          </div>

          <div className="grid grid-cols-3 gap-2 items-center">
            <button
              data-testid="pipeline-fleeting"
              className="border rounded-lg p-3 text-center hover:bg-accent transition-colors border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950"
              onClick={() => navigate({ to: "/notes/fleeting" })}
            >
              <div className="flex items-center justify-center gap-1 text-amber-600 dark:text-amber-400">
                <Sparkles className="h-3.5 w-3.5" />
                <p className="text-lg font-bold">{stats.fleeting_count}</p>
              </div>
              <p className="text-xs text-muted-foreground">閃念</p>
            </button>

            <div className="flex items-center justify-center">
              <ChevronRight className="h-4 w-4 text-muted-foreground -mx-2" />
              <button
                data-testid="pipeline-developing"
                className="border rounded-lg p-3 text-center hover:bg-accent transition-colors border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 flex-1"
                onClick={() => navigate({ to: "/notes/developing" })}
              >
                <div className="flex items-center justify-center gap-1 text-blue-600 dark:text-blue-400">
                  <p className="text-lg font-bold">{stats.developing_count}</p>
                </div>
                <p className="text-xs text-muted-foreground">發展中</p>
              </button>
              <ChevronRight className="h-4 w-4 text-muted-foreground -mx-2" />
            </div>

            <button
              data-testid="pipeline-permanent"
              className="border rounded-lg p-3 text-center hover:bg-accent transition-colors border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950"
              onClick={() => navigate({ to: "/notes/permanent" })}
            >
              <div className="flex items-center justify-center gap-1 text-green-600 dark:text-green-400">
                <p className="text-lg font-bold">{stats.permanent_count}</p>
              </div>
              <p className="text-xs text-muted-foreground">永久</p>
            </button>
          </div>
        </section>

        {/* Section 3: Monthly Summary */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">本月活動</h2>
          </div>

          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-around text-center">
              <div>
                <p className="text-lg font-bold">{stats.created_this_month}</p>
                <p className="text-xs text-muted-foreground">建立</p>
              </div>
              <div className="h-8 w-px bg-border" />
              <div>
                <p className="text-lg font-bold">{stats.done_this_month}</p>
                <p className="text-xs text-muted-foreground">完成</p>
              </div>
              <div className="h-8 w-px bg-border" />
              <div>
                <p className="text-lg font-bold">{stats.exported_this_month}</p>
                <p className="text-xs text-muted-foreground">匯出</p>
              </div>
            </div>
          </div>
        </section>

        {/* Section 4: Category Distribution */}
        {categoryDist.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">分類分布</h2>

            <div className="border rounded-lg p-4 space-y-3">
              {categoryDist.map((cat) => (
                <div key={cat.category_id ?? "uncategorized"} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      {cat.color && (
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{ backgroundColor: cat.color }}
                        />
                      )}
                      <span>{cat.category_name}</span>
                    </div>
                    <span className="text-muted-foreground">{cat.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-primary"
                      style={{
                        width: `${(cat.count / maxCategoryCount) * 100}%`,
                        backgroundColor: cat.color ?? undefined,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
