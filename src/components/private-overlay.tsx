import { Lock } from "lucide-react";

interface PrivateOverlayProps {
  visible: boolean;
  onDismiss?: () => void;
}

export function PrivateOverlay({ visible, onDismiss }: PrivateOverlayProps) {
  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 bg-background flex items-center justify-center cursor-pointer"
      style={{ zIndex: 9999 }}
      onClick={onDismiss}
    >
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Lock className="h-12 w-12" />
        <p className="text-lg font-medium">已鎖定</p>
        <p className="text-sm">點擊解鎖</p>
      </div>
    </div>
  );
}
