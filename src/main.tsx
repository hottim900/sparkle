import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { toast } from "sonner";
import "./index.css";
import App from "./App";
import { setDeferredPrompt } from "./components/install-prompt";

// Listen for PWA install prompt before render
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  setDeferredPrompt(e as Parameters<typeof setDeferredPrompt>[0]);
  window.dispatchEvent(new Event("pwa-install-available"));
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <App />
    </ThemeProvider>
  </StrictMode>,
);

// Service Worker registration
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      console.log("SW registered:", reg.scope);

      // Check for SW updates periodically (every 60 minutes)
      setInterval(() => reg.update(), 60 * 60 * 1000);
    } catch (err) {
      console.log("SW registration failed:", err);
    }

    // Auto-reload when new SW activates (works with skipWaiting + clientsClaim).
    // Only reload on SW *updates* (controller already existed), not on first
    // install (controller was null), to avoid reload loops during E2E tests.
    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });

  // Listen for messages from SW
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "OFFLINE_SYNC") {
      toast.success(`已同步 ${event.data.count} 個離線項目`);
    }
    if (event.data?.type === "GET_AUTH_TOKEN") {
      const token = localStorage.getItem("auth_token") || "";
      event.ports[0]?.postMessage({ token });
    }
  });

  // Replay offline queue when back online
  window.addEventListener("online", () => {
    navigator.serviceWorker.controller?.postMessage({ type: "REPLAY_QUEUE" });
  });
}
