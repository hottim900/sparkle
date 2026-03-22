import { Lock } from "lucide-react";

interface PrivateOverlayProps {
  visible: boolean;
}

export function PrivateOverlay({ visible }: PrivateOverlayProps) {
  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 bg-background flex items-center justify-center"
      style={{ zIndex: 9999 }}
    >
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Lock className="h-12 w-12" />
        <p className="text-lg font-medium">已鎖定</p>
      </div>
    </div>
  );
}
