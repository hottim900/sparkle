import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  getStats,
  getUnreviewed,
  getRecent,
  getAttention,
  getDashboardStale,
  getCategoryDistribution,
} from "@/lib/api";
import { parseItems, type ParsedItem } from "@/lib/types";
import type { AttentionItem, DashboardStaleItem } from "@/lib/types";
import { queryKeys } from "@/lib/query-keys";
import { formatRelativeTime } from "@/lib/date-utils";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  TrendingUp,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Clock,
  Loader2,
  Inbox,
  CalendarPlus,
  AlertCircle,
} from "lucide-react";

function typeLabel(item: ParsedItem): string {
  const labels: Record<string, string> = {
    note: "筆記",
    todo: "待辦",
    scratch: "暫存",
  };
  return labels[item.type] ?? item.type;
}

function getItemRoute(item: ParsedItem): string {
  if (item.type === "todo") return item.status === "done" ? "/todos/done" : "/todos";
  if (item.type === "scratch") return "/scratch";
  return `/notes/${item.status}`;
}

interface DashboardCardProps {
  title: string;
  icon: React.ReactNode;
  count: number | undefined;
  items: ParsedItem[];
  borderColor: string;
  loading: boolean;
  viewAllPath: string;
  renderItem: (item: ParsedItem) => React.ReactNode;
  onItemClick: (item: ParsedItem) => void;
  emptyText: string;
}

function DashboardCard({
  title,
  icon,
  count,
  items,
  borderColor,
  loading,
  viewAllPath,
  renderItem,
  onItemClick,
  emptyText,
}: DashboardCardProps) {
  const navigate = useNavigate();

  return (
    <div className={`border rounded-lg border-l-4 ${borderColor} overflow-hidden`}>
      <div className="p-3 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          {icon}
          {title}
        </div>
        {count !== undefined && count > 0 && (
          <Badge variant="secondary" className="text-xs">
            {count}
          </Badge>
        )}
      </div>

      <div className="px-3 pb-3 space-y-1">
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 text-center">{emptyText}</p>
        ) : (
          <>
            {items.map((item) => (
              <button
                key={item.id}
                className="w-full text-left rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                onClick={() => onItemClick(item)}
              >
                {renderItem(item)}
              </button>
            ))}
            {count !== undefined && count > items.length && (
              <button
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-1"
                onClick={() => navigate({ to: viewAllPath })}
              >
                查看全部 ({count})
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const [staleExpanded, setStaleExpanded] = useState(false);

  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
  } = useQuery({
    queryKey: queryKeys.stats,
    queryFn: getStats,
  });

  const { data: unreviewedData, isLoading: unreviewedLoading } = useQuery({
    queryKey: queryKeys.unreviewed,
    queryFn: () => getUnreviewed({ limit: 5 }),
  });

  const { data: recentData, isLoading: recentLoading } = useQuery({
    queryKey: queryKeys.recent,
    queryFn: () => getRecent({ limit: 5 }),
  });

  const { data: attentionData, isLoading: attentionLoading } = useQuery({
    queryKey: queryKeys.attention,
    queryFn: () => getAttention({ limit: 5 }),
  });

  const { data: staleData, isLoading: staleLoading } = useQuery({
    queryKey: queryKeys.dashboardStale,
    queryFn: () => getDashboardStale({ limit: 10 }),
  });

  const { data: categoryDist = [], isLoading: categoryLoading } = useQuery({
    queryKey: queryKeys.categoryDistribution,
    queryFn: () => getCategoryDistribution().then((r) => r.distribution),
  });

  useEffect(() => {
    if (statsError) toast.error("無法載入總覽資料");
  }, [statsError]);

  const unreviewedItems = unreviewedData ? parseItems(unreviewedData.items) : [];
  const recentItems = recentData ? parseItems(recentData.items) : [];
  const attentionItems = attentionData ? parseItems(attentionData.items as AttentionItem[]) : [];
  const attentionRawItems = attentionData?.items ?? [];

  if (statsLoading || categoryLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) return null;

  const maxCategoryCount = Math.max(...categoryDist.map((d) => d.count), 1);

  function navigateToItem(item: ParsedItem) {
    navigate({ to: getItemRoute(item), search: { item: item.id } });
  }

  return (
    <div className="flex-1 overflow-y-auto pb-4">
      <div className="max-w-2xl mx-auto p-4 space-y-6">
        {/* Page title */}
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-5 w-5" />
          <h1 className="text-xl font-bold">總覽</h1>
        </div>

        {/* Section 1: Dashboard Cards */}
        <section className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Unreviewed card */}
            <DashboardCard
              title="未處理"
              icon={<Inbox className="h-4 w-4" />}
              count={unreviewedData?.total}
              items={unreviewedItems}
              borderColor="border-l-amber-500"
              loading={unreviewedLoading}
              viewAllPath="/unreviewed"
              emptyText="沒有未處理的項目"
              renderItem={(item) => (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs shrink-0">
                    {typeLabel(item)}
                  </Badge>
                  <span className="truncate">{item.title}</span>
                </div>
              )}
              onItemClick={navigateToItem}
            />

            {/* Recently created card */}
            <DashboardCard
              title="最近新增"
              icon={<CalendarPlus className="h-4 w-4" />}
              count={recentData?.total}
              items={recentItems}
              borderColor="border-l-blue-500"
              loading={recentLoading}
              viewAllPath="/recent"
              emptyText="最近沒有新增項目"
              renderItem={(item) => (
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{item.title}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatRelativeTime(item.created)}
                  </span>
                </div>
              )}
              onItemClick={navigateToItem}
            />

            {/* Needs attention card */}
            <DashboardCard
              title="需要關注"
              icon={<AlertCircle className="h-4 w-4" />}
              count={attentionData?.total}
              items={attentionItems}
              borderColor="border-l-red-500"
              loading={attentionLoading}
              viewAllPath="/attention"
              emptyText="沒有需要關注的項目"
              renderItem={(item) => {
                const rawItem = attentionRawItems.find((r) => r.id === item.id);
                const reason = rawItem ? (rawItem as AttentionItem).attention_reason : undefined;
                return (
                  <div className="flex items-center gap-2">
                    {reason === "overdue" && (
                      <Badge variant="destructive" className="text-xs shrink-0">
                        逾期
                      </Badge>
                    )}
                    {reason === "high_priority" && (
                      <Badge className="text-xs shrink-0 bg-orange-500 hover:bg-orange-600">
                        高優先
                      </Badge>
                    )}
                    <span className="truncate">{item.title}</span>
                  </div>
                );
              }}
              onItemClick={navigateToItem}
            />
          </div>

          {/* Stale notes collapsible row */}
          {!staleLoading && staleData && staleData.total > 0 && (
            <div>
              <button
                className="w-full border rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors flex items-center justify-between"
                onClick={() => setStaleExpanded(!staleExpanded)}
              >
                <span>
                  <Clock className="h-3.5 w-3.5 inline mr-1.5" />
                  {staleData.total} 個發展中筆記超過設定天數未更新
                </span>
                {staleExpanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
              {staleExpanded && (
                <div className="mt-2 space-y-1">
                  {staleData.items.map((item: DashboardStaleItem) => (
                    <button
                      key={item.id}
                      className="w-full border rounded-lg p-3 text-left hover:bg-accent transition-colors"
                      onClick={() =>
                        navigate({
                          to: "/notes/developing",
                          search: { item: item.id },
                        })
                      }
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
