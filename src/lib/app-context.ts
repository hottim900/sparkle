import { createContext, useContext } from "react";

export interface AppContextValue {
  obsidianEnabled: boolean;
  isOnline: boolean;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppContext.Provider");
  return ctx;
}
