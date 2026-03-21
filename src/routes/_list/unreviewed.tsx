import { createFileRoute, useNavigate, type NavigateOptions } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getUnreviewed } from "@/lib/api";
import { parseItems } from "@/lib/types";
import { queryKeys } from "@/lib/query-keys";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

function UnreviewedPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: [...queryKeys.unreviewed, "full"],
    queryFn: () => getUnreviewed({ limit: 100 }),
  });
  const items = data ? parseItems(data.items) : [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">未處理</h2>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {items.length === 0 && !isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">沒有未處理的項目</p>
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
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs shrink-0">
                {item.type === "todo" ? "待辦" : item.type === "scratch" ? "暫存" : "筆記"}
              </Badge>
              <span className="text-sm truncate">{item.title}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_list/unreviewed")({
  component: UnreviewedPage,
});
