import { createFileRoute, useNavigate, type NavigateOptions } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getAttention } from "@/lib/api";
import { parseItems } from "@/lib/types";
import type { AttentionItem } from "@/lib/types";
import { queryKeys } from "@/lib/query-keys";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

function AttentionPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: [...queryKeys.attention, "full"],
    queryFn: () => getAttention({ limit: 100 }),
  });
  const items = data ? parseItems(data.items as AttentionItem[]) : [];
  const rawItems = data?.items ?? [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-4 space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">需要關注</h2>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {items.length === 0 && !isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">沒有需要關注的項目</p>
        ) : null}
        {items.map((item) => {
          const rawItem = rawItems.find((r) => r.id === item.id);
          const reason = rawItem ? (rawItem as AttentionItem).attention_reason : undefined;
          return (
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
                <span className="text-sm truncate">{item.title}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_list/attention")({
  component: AttentionPage,
});
