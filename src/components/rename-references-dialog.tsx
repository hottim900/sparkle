import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { undoRename, type SweptReferences } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { toast } from "sonner";
import { AlertTriangle, Undo2, ExternalLink } from "lucide-react";

/**
 * DES-5 rename references dialog. Shown after a title rename PATCH whose
 * response carried `swept_references.rewritten_count > 0` (the hook in
 * `useItemForm` fires it). Two visual modes per spec:
 *
 *   - `inline`  — N ≤ INLINE_LIMIT: render the full list of rewritten
 *                  source titles, each clickable to /item/:id.
 *   - `summary` — N > INLINE_LIMIT: render a summary count plus the first
 *                  five titles + "and X more" + the same scope copy.
 *
 * Skipped-share-token warning is always rendered when present (rare path:
 * private target with shared sources — the engine preserves the old
 * `[[Title]]` text in those sources to avoid the title leak).
 *
 * Scope copy distinguishes Sparkle (rewritten in-place) from Obsidian
 * (untouched — daily-notes and vault `.md` files). The wording mirrors
 * `docs/wikilink-spec.md` DES-5: "Obsidian 的 rename 才是處理 vault 的方式".
 */
const INLINE_LIMIT = 20;
const SUMMARY_PREVIEW = 5;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  oldTitle: string;
  newTitle: string;
  swept: SweptReferences;
}

export function RenameReferencesDialog({ open, onOpenChange, oldTitle, newTitle, swept }: Props) {
  const queryClient = useQueryClient();
  const [confirmingUndo, setConfirmingUndo] = useState(false);

  const undoMutation = useMutation({
    mutationFn: (historyId: string) => undoRename(historyId),
    onSuccess: (result) => {
      toast.success(`已還原 — 重寫 ${result.rewrittenCount} 個來源`);
      // Same broad-invalidate strategy as the admin recent-renames page —
      // undo rewrites every source row and flips the target title back, so
      // every cache slice reading items_active needs to refetch.
      queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.private.list() });
      queryClient.invalidateQueries({ queryKey: ["private", "search"] });
      queryClient.invalidateQueries({ queryKey: queryKeys.recent });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags });
      queryClient.invalidateQueries({ queryKey: ["wikilinks", "resolve"] });
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(`還原失敗：${err instanceof Error ? err.message : String(err)}`);
      setConfirmingUndo(false);
    },
  });

  const isSummaryMode = swept.rewritten_count > INLINE_LIMIT;
  const sourcesToList = isSummaryMode
    ? swept.rewritten_sources.slice(0, SUMMARY_PREVIEW)
    : swept.rewritten_sources;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>標題已重新命名</DialogTitle>
          <DialogDescription className="space-y-1">
            <span className="block">
              「<span className="font-medium text-foreground">{oldTitle}</span>」→「
              <span className="font-medium text-foreground">{newTitle}</span>」
            </span>
            <span className="block">
              {swept.rewritten_count} 個 Sparkle 引用已更新。Vault daily-notes 不會變動 — Obsidian
              的 rename 功能才是處理 vault 的方式。
            </span>
          </DialogDescription>
        </DialogHeader>

        {swept.skipped_share_token_source_ids.length > 0 && (
          <div className="rounded-md border border-amber-400/40 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm flex gap-2">
            <AlertTriangle className="size-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <div className="font-medium">
                {swept.skipped_share_token_source_ids.length} 個來源未更新（share-token 防洩漏）
              </div>
              <div className="text-muted-foreground mt-0.5">
                這些來源有公開 share token，且本筆筆記為私人 — 為避免公開頁面顯示新私人標題，原
                <code className="text-xs">[[舊標題]]</code>引用文字保留不動，會顯示為未解析狀態。
              </div>
            </div>
          </div>
        )}

        {swept.rewritten_count > 0 && (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {isSummaryMode ? `前 ${SUMMARY_PREVIEW} 筆來源` : `已更新的來源`}
            </div>
            <ul className="space-y-1.5">
              {sourcesToList.map((source) => (
                <li key={source.id} className="text-sm">
                  <Link
                    to="/item/$id"
                    params={{ id: source.id }}
                    className="inline-flex items-center gap-1 text-primary underline decoration-dotted underline-offset-2 hover:no-underline"
                    onClick={() => onOpenChange(false)}
                  >
                    {source.title || <span className="italic">(未命名)</span>}
                    <ExternalLink className="size-3" />
                  </Link>
                </li>
              ))}
            </ul>
            {isSummaryMode && (
              <div className="text-xs text-muted-foreground pt-1">
                還有 {swept.rewritten_count - SUMMARY_PREVIEW} 筆未顯示（前往
                「最近的重新命名」管理頁查看全部）
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-row items-center justify-end gap-2">
          {swept.history_id && !confirmingUndo && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmingUndo(true)}
              disabled={undoMutation.isPending}
            >
              <Undo2 className="size-4 mr-1" />
              還原此 rename
            </Button>
          )}
          {swept.history_id && confirmingUndo && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmingUndo(false)}
                disabled={undoMutation.isPending}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => undoMutation.mutate(swept.history_id!)}
                disabled={undoMutation.isPending}
              >
                {undoMutation.isPending ? "還原中…" : "確認還原"}
              </Button>
            </>
          )}
          {!confirmingUndo && (
            <Button size="sm" onClick={() => onOpenChange(false)}>
              關閉
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
