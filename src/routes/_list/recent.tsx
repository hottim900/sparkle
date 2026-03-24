import { createFileRoute, useNavigate, type NavigateOptions } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getRecent } from "@/lib/api";
import { parseItems } from "@/lib/types";
import { queryKeys } from "@/lib/query-keys";
import { formatRelativeTime } from "@/lib/date-utils";
import { ActivityBadge } from "@/components/dashboard";
import { Loader2 } from "lucide-react";

function RecentPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: [...queryKeys.recent, "full"],
    queryFn: () => getRecent({ limit: 100 }),
  });
  const items = data ? parseItems(data.items) : [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">最近活動</h2>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {items.length === 0 && !isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">最近沒有活動</p>
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
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <ActivityBadge activity={item.activity} />
                <span className="text-sm truncate">{item.title}</span>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {formatRelativeTime(item.modified)}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_list/recent")({
  component: RecentPage,
});
