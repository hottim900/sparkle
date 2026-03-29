import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Pause, Play } from "lucide-react";
import { updateItem } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { ParsedItem } from "@/lib/types";
import { toast } from "sonner";

interface PauseToggleProps {
  item: ParsedItem;
  isOnline: boolean;
  onItemUpdate: (updater: (prev: ParsedItem | null) => ParsedItem | null) => void;
}

export function PauseToggle({ item, isOnline, onItemUpdate }: PauseToggleProps) {
  const queryClient = useQueryClient();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [context, setContext] = useState("");
  const [resuming, setResuming] = useState(false);

  const isPaused = item.paused === 1;

  const invalidateAfterPause = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    queryClient.invalidateQueries({ queryKey: queryKeys.pausedCount });
    queryClient.invalidateQueries({ queryKey: queryKeys.unreviewed });
    queryClient.invalidateQueries({ queryKey: queryKeys.attention });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboardStale });
    queryClient.invalidateQueries({ queryKey: queryKeys.focus });
    queryClient.invalidateQueries({ queryKey: ["dashboardWeek"] });
  }, [queryClient]);

  const handlePause = useCallback(
    async (pausedContext?: string) => {
      setPopoverOpen(false);

      // Optimistic update
      onItemUpdate((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          paused: 1,
          pausedAt: new Date().toISOString(),
          pausedContext: pausedContext ?? null,
        };
      });

      try {
        const payload: { paused: boolean; pausedContext?: string } = { paused: true };
        if (pausedContext) payload.pausedContext = pausedContext;
        await updateItem(item.id, payload);
        invalidateAfterPause();
        toast.success("已暫停");
      } catch (err) {
        // Rollback
        onItemUpdate((prev) => {
          if (!prev) return prev;
          return { ...prev, paused: 0, pausedAt: null, pausedContext: null };
        });
        toast.error(err instanceof Error ? err.message : "暫停失敗");
      }
      setContext("");
    },
    [item.id, onItemUpdate, invalidateAfterPause],
  );

  const handleResume = useCallback(async () => {
    setResuming(true);
    // Optimistic update
    const prevPausedAt = item.pausedAt;
    const prevPausedContext = item.pausedContext;

    onItemUpdate((prev) => {
      if (!prev) return prev;
      return { ...prev, paused: 0, pausedAt: null, pausedContext: null };
    });

    try {
      await updateItem(item.id, { paused: false });
      invalidateAfterPause();
      toast.success("已恢復");
    } catch (err) {
      // Rollback
      onItemUpdate((prev) => {
        if (!prev) return prev;
        return { ...prev, paused: 1, pausedAt: prevPausedAt, pausedContext: prevPausedContext };
      });
      toast.error(err instanceof Error ? err.message : "恢復失敗");
    } finally {
      setResuming(false);
    }
  }, [item.id, item.pausedAt, item.pausedContext, onItemUpdate, invalidateAfterPause]);

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
