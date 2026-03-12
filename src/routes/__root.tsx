import { Suspense, useMemo, useState, useCallback } from "react";
import { createRootRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "@/components/sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { OfflineIndicator } from "@/components/offline-indicator";
import { InstallPrompt } from "@/components/install-prompt";
import { SearchBar } from "@/components/search-bar";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { getConfig } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { AppContext } from "@/lib/app-context";
import { rootSearchSchema } from "@/lib/search-params";
import { isListRoute } from "@/lib/navigation";
import { LoadingFallback } from "@/components/loading-fallback";
import { X } from "lucide-react";

function MobileSearchOverlay({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (item: { id: string }) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col md:hidden">
      <div className="flex items-center gap-2 p-3 border-b">
        <div className="flex-1">
          <SearchBar onSelect={onSelect} autoFocus />
        </div>
        <button onClick={onClose} className="p-2 text-muted-foreground">
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold text-muted-foreground">404</h1>
      <p className="text-muted-foreground">找不到此頁面</p>
      <Link to="/notes/fleeting" className="text-primary hover:underline">
        回到首頁
      </Link>
    </div>
  );
}

function RootLayout() {
  const isOnline = useOnlineStatus();
  const { item: selectedId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const { data: obsidianEnabled = false } = useQuery({
    queryKey: queryKeys.config,
    queryFn: () => getConfig().then((c) => c.obsidian_export_enabled),
  });

  const handleMobileSearchSelect = useCallback(
    (item: { id: string }) => {
      setMobileSearchOpen(false);
      navigate({ search: { item: item.id } });
    },
    [navigate],
  );

  const keyboardHandlers = useMemo(
    () => ({
      onNewItem: () => {
        const input = document.querySelector<HTMLInputElement>('input[placeholder="快速記錄..."]');
        input?.focus();
      },
      onSearch: () => {
        const input = document.querySelector<HTMLInputElement>('input[placeholder="搜尋..."]');
        if (input) {
          input.focus();
        } else {
          // Mobile: sidebar is hidden, show search overlay
          setMobileSearchOpen(true);
        }
      },
      onClose: () => {
        navigate({ search: (prev) => ({ ...prev, item: undefined }) });
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

        {/* Mobile search overlay */}
        {mobileSearchOpen && (
          <MobileSearchOverlay
            onClose={() => setMobileSearchOpen(false)}
            onSelect={handleMobileSearchSelect}
          />
        )}

        {/* Mobile Bottom Nav - hidden when detail panel is open on list routes */}
        {!hideBottomNav && <BottomNav onSearchClick={() => setMobileSearchOpen(true)} />}
      </div>
    </AppContext.Provider>
  );
}

export const Route = createRootRoute({
  validateSearch: (search: Record<string, unknown>) => rootSearchSchema.parse(search),
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});
