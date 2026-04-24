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
      // 409 ALREADY_RELEASED: stub is gone (two tabs raced, or manually
      // released already). 404 NOT_VAULT_ITEM: caller hit this endpoint on an
      // active id — shouldn't happen from the UI since the button is gated on
      // origin='vault', but treat the same way ("已釋出" surfaces "this is no
      // longer releasable from this UI"). Anything else is a real failure.
      const status = (err as { status?: number } | null)?.status;
      if (status === 409 || status === 404) {
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
