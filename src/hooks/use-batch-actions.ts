import { useMutation } from "@tanstack/react-query";
import { batchAction } from "@/lib/api";
import { toast } from "sonner";
import type { BatchActionConfig } from "@/lib/batch-actions";

export function useBatchActions(
  selectedIds: Set<string>,
  exitSelectionMode: () => void,
  invalidate: () => void,
) {
  const batchMutation = useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: string }) => batchAction(ids, action),
    onSuccess: () => invalidate(),
  });

  const handleBatchAction = async (config: BatchActionConfig) => {
    if (selectedIds.size === 0) return;

    if (config.confirm) {
      const confirmed = window.confirm(
        config.confirm.replace("所選項目", `所選的 ${selectedIds.size} 個項目`),
      );
      if (!confirmed) return;
    }

    try {
      const result = await batchMutation.mutateAsync({
        ids: Array.from(selectedIds),
        action: config.action,
      });
      const skippedMsg = result.skipped > 0 ? `，跳過 ${result.skipped} 筆` : "";

      if (config.action === "export" && result.skipped > 0) {
        const errorCount = result.errors?.length ?? 0;
        const failMsg = errorCount > 0 ? `${errorCount} 筆失敗` : `${result.skipped} 筆跳過`;
        toast.warning(`匯出 ${result.affected} 筆成功，${failMsg}`);
      } else {
        toast.success(`已${config.label} ${result.affected} 個項目${skippedMsg}`);
      }
      exitSelectionMode();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批次操作失敗");
    }
  };

  return { handleBatchAction, isBatchPending: batchMutation.isPending };
}
