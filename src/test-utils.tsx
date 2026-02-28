import type { ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { AppContext, type AppContextValue } from "@/lib/app-context";

const defaultContext: AppContextValue = {
  currentView: "notes",
  onViewChange: vi.fn(),
  selectedItem: null,
  onSelectItem: vi.fn(),
  selectedTag: undefined,
  onTagSelect: vi.fn(),
  onNavigate: vi.fn(),
  onBack: vi.fn(),
  onClearDetail: vi.fn(),
  canGoBack: false,
  obsidianEnabled: false,
  refreshKey: 0,
  refresh: vi.fn(),
};

export function renderWithContext(
  ui: ReactNode,
  contextOverrides: Partial<AppContextValue> = {},
  renderOptions?: Omit<RenderOptions, "wrapper">,
) {
  const contextValue = { ...defaultContext, ...contextOverrides };
  return render(ui, {
    wrapper: ({ children }) => (
      <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>
    ),
    ...renderOptions,
  });
}
