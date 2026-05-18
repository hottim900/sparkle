import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listRecentRenames, undoRename } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";

/**
 * Admin page: recent title renames audit log.
 * Wraps GET /api/wikilinks/admin/recent-renames + undo button.
 * Operator-facing; not linked from main nav (operator opens via URL).
 */
function RecentRenamesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "recent-renames"],
    queryFn: () => listRecentRenames(100),
  });

  const undoMutation = useMutation({
    mutationFn: (historyId: string) => undoRename(historyId),
    onSuccess: (result) => {
      toast.success(`已還原 — 重寫 ${result.rewrittenCount} 個來源`);
      queryClient.invalidateQueries({ queryKey: ["admin", "recent-renames"] });
    },
    onError: (err) => {
      toast.error(`還原失敗：${err instanceof Error ? err.message : String(err)}`);
    },
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">載入中…</div>;
  }
  if (error) {
    return (
      <div className="p-6 text-destructive">
        無法載入：{error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  const renames = data?.renames ?? [];

  return (
    <div className="flex-1 min-w-0 p-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">最近的標題重新命名</h1>
        <p className="text-sm text-muted-foreground">
          顯示最近 {renames.length} 筆 rename_history 紀錄。30 天後由 cron 自動清除。
        </p>
      </header>

      {renames.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          無 rename 紀錄
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">時間</th>
                <th className="px-3 py-2 font-medium">原標題</th>
                <th className="px-3 py-2 font-medium">新標題</th>
                <th className="px-3 py-2 font-medium text-right">已掃</th>
                <th className="px-3 py-2 font-medium">執行者</th>
                <th className="px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {renames.map((r) => {
                const isUndo = r.performed_by.startsWith("undo:");
                return (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {new Date(r.performed_at).toLocaleString("zh-TW")}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to="/item/$id"
                        params={{ id: r.target_id }}
                        className="text-primary underline decoration-dotted underline-offset-2 hover:no-underline"
                      >
                        {r.old_title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-medium">{r.new_title}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.source_count}</td>
                    <td className="px-3 py-2 text-xs">
                      {isUndo ? (
                        <span className="text-amber-600 dark:text-amber-400">undo</span>
                      ) : (
                        r.performed_by
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {!isUndo && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={undoMutation.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `確定還原「${r.new_title}」→「${r.old_title}」?\n將重寫 ${r.source_count} 個來源。`,
                              )
                            ) {
                              undoMutation.mutate(r.id);
                            }
                          }}
                          aria-label="還原此 rename"
                        >
                          <Undo2 className="size-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/admin/recent-renames")({
  component: RecentRenamesPage,
});
