import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Pause, Play } from "lucide-react";
import { updateItem } from "@/lib/api";
import { useInvalidateAfterItemMutation } from "@/hooks/use-invalidate";
import { usePauseResume } from "@/hooks/use-pause-resume";
import type { ParsedItem } from "@/lib/types";
import { toast } from "sonner";

interface PauseToggleProps {
  item: ParsedItem;
  isOnline: boolean;
  onItemUpdate: (updater: (prev: ParsedItem | null) => ParsedItem | null) => void;
}

export function PauseToggle({ item, isOnline, onItemUpdate }: PauseToggleProps) {
  const invalidateAfterSave = useInvalidateAfterItemMutation();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [context, setContext] = useState("");

  const isPaused = item.paused === 1;
  const { handleResume, resuming } = usePauseResume(item, onItemUpdate);

  const handlePause = useCallback(
    async (paused_context?: string) => {
      setPopoverOpen(false);

      // Optimistic update
      onItemUpdate((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          paused: 1,
          paused_at: new Date().toISOString(),
          paused_context: paused_context ?? null,
        };
      });

      try {
        const payload: { paused: boolean; paused_context?: string } = { paused: true };
        if (paused_context) payload.paused_context = paused_context;
        await updateItem(item.id, payload);
        invalidateAfterSave("paused");
        toast.success("已暫停");
      } catch (err) {
        // Rollback
        onItemUpdate((prev) => {
          if (!prev) return prev;
          return { ...prev, paused: 0, paused_at: null, paused_context: null };
        });
        toast.error(err instanceof Error ? err.message : "暫停失敗");
      }
      setContext("");
    },
    [item.id, onItemUpdate, invalidateAfterSave],
  );

  if (isPaused) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="gap-1 text-xs border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
        onClick={handleResume}
        disabled={!isOnline || resuming}
      >
        <Play className="h-3 w-3" />
        恢復
      </Button>
    );
  }

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1 text-xs" disabled={!isOnline}>
          <Pause className="h-3 w-3" />
          暫停
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="space-y-3">
          <div>
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value.slice(0, 500))}
              placeholder="下次回來時，你想記住什麼？"
              className="resize-none text-sm"
              rows={3}
            />
            <p className="text-xs text-muted-foreground text-right mt-1">{context.length}/500</p>
          </div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground underline"
              onClick={() => handlePause()}
            >
              不附備忘直接暫停
            </button>
            <Button size="sm" onClick={() => handlePause(context || undefined)}>
              暫停
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
