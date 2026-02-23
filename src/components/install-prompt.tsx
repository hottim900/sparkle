import { useState, useEffect } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

export function setDeferredPrompt(e: BeforeInstallPromptEvent) {
  deferredPrompt = e;
}

export function InstallPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (deferredPrompt) {
      setShow(true);
    }

    const handler = () => setShow(true);
    window.addEventListener("pwa-install-available", handler);

    return () => {
      window.removeEventListener("pwa-install-available", handler);
    };
  }, []);

  if (!show) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      deferredPrompt = null;
      setShow(false);
    }
  };

  const handleDismiss = () => {
    setShow(false);
  };

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-md animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="flex items-center gap-3 rounded-lg border bg-background p-3 shadow-lg">
        <Download className="h-5 w-5 shrink-0 text-primary" />
        <p className="flex-1 text-sm">安裝到主畫面，享受更好的體驗</p>
        <div className="flex items-center gap-1">
          <Button size="sm" onClick={handleInstall}>
            安裝
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={handleDismiss}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
