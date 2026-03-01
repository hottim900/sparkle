import { useOnlineStatus } from "@/hooks/use-online-status";
import { WifiOff } from "lucide-react";

export function OfflineIndicator() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div className="fixed top-0 left-0 right-0 bg-yellow-500 text-yellow-950 text-center py-1 text-sm z-50 flex items-center justify-center gap-1">
      <WifiOff className="h-3.5 w-3.5" />
      離線模式
    </div>
  );
}
