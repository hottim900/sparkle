import type { ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  isOnline: true,
};

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

export function renderWithContext(
  ui: ReactNode,
  contextOverrides: Partial<AppContextValue> = {},
  renderOptions?: Omit<RenderOptions, "wrapper">,
) {
  const contextValue = { ...defaultContext, ...contextOverrides };
  const queryClient = createTestQueryClient();
  return render(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>
      </QueryClientProvider>
    ),
    ...renderOptions,
  });
}
