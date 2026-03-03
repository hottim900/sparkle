import { useState, useEffect } from "react";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    // Re-sync when page becomes visible (mobile browsers may not fire
    // online/offline events while the tab is backgrounded)
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        setOnline(navigator.onLine);
      }
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return online;
}
