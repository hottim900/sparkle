import { createFileRoute, useNavigate, type NavigateOptions } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getDashboardStale } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { Badge } from "@/components/ui/badge";
import { Clock, Loader2 } from "lucide-react";

function StalePage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: [...queryKeys.dashboardStale, "full"],
    queryFn: () => getDashboardStale({ limit: 100 }),
  });
  const items = data?.items ?? [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">過期筆記</h2>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {items.length === 0 && !isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">沒有過期的筆記</p>
        ) : null}
        {items.map((item) => (
          <button
            key={item.id}
            className="w-full border rounded-lg p-3 text-left hover:bg-accent"
            onClick={() =>
              navigate({
                search: (prev) => ({ ...prev, item: item.id }),
              } as NavigateOptions)
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
    </div>
  );
}

export const Route = createFileRoute("/_list/stale")({
  component: StalePage,
});
