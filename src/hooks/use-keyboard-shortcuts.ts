import { useEffect } from "react";

interface KeyboardShortcutHandlers {
  onNewItem: () => void;
  onSearch: () => void;
  onClose: () => void;
}

const IGNORED_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = document.activeElement?.tagName ?? "";
      if (IGNORED_TAGS.has(tag)) {
        if (e.key === "Escape") {
          (document.activeElement as HTMLElement)?.blur();
        }
        return;
      }

      switch (e.key) {
        case "n":
          e.preventDefault();
          handlers.onNewItem();
          break;
        case "/":
          e.preventDefault();
          handlers.onSearch();
          break;
        case "Escape":
          handlers.onClose();
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handlers]);
}
