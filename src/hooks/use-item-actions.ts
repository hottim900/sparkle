import { useState } from "react";
import { deleteItem, exportItem } from "@/lib/api";
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

  return { handleDelete, handleExport, exporting };
}
