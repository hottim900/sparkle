import { useState, useCallback } from "react";
import { updateItem } from "@/lib/api";
import { useInvalidateAfterItemMutation } from "@/hooks/use-invalidate";
import type { ParsedItem } from "@/lib/types";
import { toast } from "sonner";

/**
 * Shared resume handler for paused items.
 * Used by PauseToggle (inline button) and item-detail (PausedBanner).
 */
export function usePauseResume(
  item: ParsedItem | null,
  onItemUpdate: (updater: (prev: ParsedItem | null) => ParsedItem | null) => void,
) {
  const invalidateAfterSave = useInvalidateAfterItemMutation();
  const [resuming, setResuming] = useState(false);

  const handleResume = useCallback(async () => {
    if (!item) return;
    setResuming(true);
    const prevPausedAt = item.paused_at;
    const prevPausedContext = item.paused_context;

    onItemUpdate((prev) => {
      if (!prev) return prev;
      return { ...prev, paused: 0, paused_at: null, paused_context: null };
    });

    try {
      await updateItem(item.id, { paused: false });
      invalidateAfterSave("paused");
      toast.success("已恢復");
    } catch (err) {
      onItemUpdate((prev) => {
        if (!prev) return prev;
        return { ...prev, paused: 1, paused_at: prevPausedAt, paused_context: prevPausedContext };
      });
      toast.error(err instanceof Error ? err.message : "恢復失敗");
    } finally {
      setResuming(false);
    }
  }, [item, onItemUpdate, invalidateAfterSave]);

  return { handleResume, resuming };
}
