import { useState } from "react";
import { deleteItem, exportItem, releaseVaultStub } from "@/lib/api";
import type { ParsedItem } from "@/lib/types";
import { toast } from "sonner";

export function useItemActions(
  item: ParsedItem | null,
  options: {
    isOnline: boolean;
    obsidianEnabled: boolean;
    invalidateAfterSave: () => void;
    onDeleted?: () => void;
  },
) {
  const { isOnline, obsidianEnabled, invalidateAfterSave, onDeleted } = options;
  const [exporting, setExporting] = useState(false);
  const [releasing, setReleasing] = useState(false);

  const handleDelete = async () => {
    if (!item) return;
    if (!isOnline) {
      toast.error("離線中，無法刪除");
      return;
    }
    try {
      await deleteItem(item.id);
      toast.success("已刪除");
      invalidateAfterSave();
      onDeleted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刪除失敗");
    }
  };

  const handleExport = async () => {
    if (!item || !obsidianEnabled) return;
    if (!isOnline) {
      toast.error("離線中，無法匯出");
      return;
    }
    setExporting(true);
    try {
      const result = await exportItem(item.id);
      toast.success(`已匯出到 Obsidian: ${result.path}`);
      invalidateAfterSave();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "匯出失敗");
    } finally {
      setExporting(false);
    }
  };

  const handleRelease = async () => {
    if (!item) return;
    if (!isOnline) {
      toast.error("離線中，無法釋出");
      return;
    }
    setReleasing(true);
    try {
      await releaseVaultStub(item.id);
      toast.success("已釋出 · vault 檔案保留");
      invalidateAfterSave();
      onDeleted?.();
    } catch (err) {
      // 404 is the only idempotent-failure path the endpoint returns: either
      // the stub was already released (two tabs raced) or the id was never in
      // items_vault (NOT_VAULT_ITEM). In both cases "already gone" is the
      // accurate user-facing summary. Everything else is a real failure.
      const status = (err as { status?: number } | null)?.status;
      if (status === 404) {
        toast.error("此筆記已釋出");
      } else {
        toast.error("釋出失敗，請重試");
      }
    } finally {
      setReleasing(false);
    }
  };

  return { handleDelete, handleExport, handleRelease, exporting, releasing };
}
