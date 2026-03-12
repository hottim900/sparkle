import { Suspense, useMemo } from "react";
import { createRootRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { OfflineIndicator } from "@/components/offline-indicator";
import { InstallPrompt } from "@/components/install-prompt";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { getConfig } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { AppContext } from "@/lib/app-context";
import { rootSearchSchema } from "@/lib/search-params";
import { isListRoute } from "@/lib/navigation";
import { LoadingFallback } from "@/components/loading-fallback";

function RootLayout() {
  const isOnline = useOnlineStatus();
  const { item: selectedId } = Route.useSearch();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { data: obsidianEnabled = false } = useQuery({
    queryKey: queryKeys.config,
    queryFn: () => getConfig().then((c) => c.obsidian_export_enabled),
  });

  const keyboardHandlers = useMemo(
    () => ({
      onNewItem: () => {
        const input = document.querySelector<HTMLInputElement>('input[placeholder="快速記錄..."]');
        input?.focus();
      },
      onSearch: () => {
        const input = document.querySelector<HTMLInputElement>('input[placeholder="搜尋..."]');
        input?.focus();
      },
      onClose: () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        navigate({ search: (prev: any) => ({ ...prev, item: undefined }) } as any);
      },
    }),
    [navigate],
  );

  useKeyboardShortcuts(keyboardHandlers);

  const hideBottomNav = !!(selectedId && isListRoute(pathname));

  return (
    <AppContext.Provider value={{ obsidianEnabled, isOnline }}>
      <div className="h-dvh flex flex-col overflow-hidden">
        <OfflineIndicator />

        {/* Inner wrapper: horizontal on desktop (sidebar + content) */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* Desktop Sidebar */}
          <div className="hidden md:flex">
            <Sidebar />
          </div>

          {/* Main content area */}
          <div className="flex-1 flex flex-col md:flex-row min-w-0 overflow-hidden">
            <Suspense fallback={<LoadingFallback />}>
              <Outlet />
            </Suspense>
          </div>
        </div>

        <InstallPrompt />

        {/* Mobile Bottom Nav - hidden when detail panel is open on list routes */}
        {!hideBottomNav && <BottomNav />}
      </div>
    </AppContext.Provider>
  );
}

export const Route = createRootRoute({
  validateSearch: (search: Record<string, unknown>) => rootSearchSchema.parse(search),
  component: RootLayout,
});
