import { Button } from "@/components/ui/button";
import { Play, PauseCircle } from "lucide-react";
import type { ParsedItem } from "@/lib/types";

interface PausedBannerProps {
  item: ParsedItem;
  isOnline: boolean;
  onResume: () => void;
  resuming?: boolean;
}

export function PausedBanner({ item, isOnline, onResume, resuming }: PausedBannerProps) {
  if (item.paused !== 1) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200 border-b border-amber-200 dark:border-amber-800">
      <PauseCircle className="h-4 w-4 shrink-0" />
      <span className="flex-1 min-w-0 truncate">{item.paused_context || "已暫停"}</span>
      <Button
        variant="outline"
        size="sm"
        className="gap-1 text-xs shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900"
        onClick={onResume}
        disabled={!isOnline || resuming}
      >
        <Play className="h-3 w-3" />
        恢復
      </Button>
    </div>
  );
}
