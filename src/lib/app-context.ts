import { createContext, useContext } from "react";
import type { ViewType, ParsedItem } from "./types";

export interface AppContextValue {
  // View state
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;

  // Selection
  selectedItem: ParsedItem | null;
  onSelectItem: (item: ParsedItem) => void;

  // Tags
  selectedTag: string | undefined;
  onTagSelect: (tag: string | undefined) => void;

  // Navigation
  onNavigate: (itemId: string) => void;
  onBack: () => void;
  onClearDetail: () => void;
  canGoBack: boolean;

  // Config
  obsidianEnabled: boolean;

  // Online status
  isOnline: boolean;

  // Refresh
  refreshKey: number;
  refresh: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppContext.Provider");
  return ctx;
}
