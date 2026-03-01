import { useState, useCallback, useMemo, useEffect, lazy, Suspense } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Toaster } from "@/components/ui/sonner";
import { QuickCapture } from "@/components/quick-capture";
import { ItemList } from "@/components/item-list";
import { SearchBar } from "@/components/search-bar";
import { Sidebar } from "@/components/sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { OfflineIndicator } from "@/components/offline-indicator";
import { InstallPrompt } from "@/components/install-prompt";
import { ErrorBoundary } from "@/components/error-boundary";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { getConfig, getItem } from "@/lib/api";
import { AppContext } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { List, ListTodo, Loader2 } from "lucide-react";
import {
  parseItem,
  type ViewType,
  type ParsedItem,
  type ItemStatus,
  type ItemType,
} from "@/lib/types";

const ItemDetail = lazy(() =>
  import("@/components/item-detail").then((m) => ({ default: m.ItemDetail })),
);
const Settings = lazy(() => import("@/components/settings").then((m) => ({ default: m.Settings })));
const FleetingTriage = lazy(() =>
  import("@/components/fleeting-triage").then((m) => ({ default: m.FleetingTriage })),
);
const Dashboard = lazy(() =>
  import("@/components/dashboard").then((m) => ({ default: m.Dashboard })),
);

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-full">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

const isMobile = () => window.innerWidth < 768;

function MainApp() {
  const [currentView, setCurrentView] = useState<ViewType>(isMobile() ? "notes" : "dashboard");
  const [selectedItem, setSelectedItem] = useState<ParsedItem | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [triageMode, setTriageMode] = useState(false);
  const [obsidianEnabled, setObsidianEnabled] = useState(false);
  const isOnline = useOnlineStatus();

  // Navigation stack for back button
  const [navStack, setNavStack] = useState<{ view: ViewType; itemId: string | null }[]>([]);

  // Sub-navigation state for notes and todos views
  const [noteSubView, setNoteSubView] = useState<
    "fleeting" | "developing" | "permanent" | "exported"
  >("fleeting");
  const [todoSubView, setTodoSubView] = useState<"active" | "done">("active");

  // Load config on mount
  const refreshConfig = useCallback(() => {
    getConfig()
      .then((config) => setObsidianEnabled(config.obsidian_export_enabled))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshConfig();
  }, [refreshConfig]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleSelect = useCallback((item: ParsedItem) => {
    setSelectedItem(item);
  }, []);

  const handleViewChange = useCallback((view: ViewType) => {
    setCurrentView(view);
    setSelectedItem(null);
    setSelectedTag(undefined);
    setTriageMode(false);
    setNavStack([]);
  }, []);

  const handleNavigate = useCallback(
    async (itemId: string) => {
      try {
        // Push current state onto nav stack before navigating
        setNavStack((prev) => [...prev, { view: currentView, itemId: selectedItem?.id ?? null }]);
        const itemData = await getItem(itemId);
        setSelectedItem(parseItem(itemData));
      } catch {
        // item may have been deleted
      }
    },
    [currentView, selectedItem?.id],
  );

  const handleBack = useCallback(() => {
    if (navStack.length === 0) {
      setSelectedItem(null);
      return;
    }
    const prev = navStack[navStack.length - 1]!;
    setNavStack((s) => s.slice(0, -1));
    if (prev.itemId) {
      // Navigate back to previous item
      getItem(prev.itemId)
        .then((data) => {
          setCurrentView(prev.view);
          setSelectedItem(parseItem(data));
        })
        .catch(() => {
          setCurrentView(prev.view);
          setSelectedItem(null);
        });
    } else {
      setCurrentView(prev.view);
      setSelectedItem(null);
    }
  }, [navStack]);

  const handleClearDetail = useCallback(() => {
    setSelectedItem(null);
    setNavStack([]);
  }, []);

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
        handleClearDetail();
      },
    }),
    [handleClearDetail],
  );

  useKeyboardShortcuts(keyboardHandlers);

  const appContextValue = useMemo(
    () => ({
      currentView,
      onViewChange: handleViewChange,
      selectedItem,
      onSelectItem: handleSelect,
      selectedTag,
      onTagSelect: setSelectedTag,
      onNavigate: handleNavigate,
      onBack: handleBack,
      onClearDetail: handleClearDetail,
      canGoBack: navStack.length > 0,
      obsidianEnabled,
      isOnline,
      refreshKey,
      refresh,
    }),
    [
      currentView,
      handleViewChange,
      selectedItem,
      handleSelect,
      selectedTag,
      handleNavigate,
      handleBack,
      handleClearDetail,
      navStack.length,
      obsidianEnabled,
      isOnline,
      refreshKey,
      refresh,
    ],
  );

  // Map view to status filter (for direct status views)
  const statusFilter: ItemStatus | undefined = (() => {
    const directStatusViews: ViewType[] = [
      "fleeting",
      "developing",
      "permanent",
      "exported",
      "active",
      "done",
      "draft",
      "archived",
    ];
    if (directStatusViews.includes(currentView)) {
      return currentView as ItemStatus;
    }
    return undefined;
  })();

  // Map view to type filter
  const typeFilter: ItemType | undefined = (() => {
    if (currentView === "notes") return "note";
    if (currentView === "todos") return "todo";
    if (currentView === "scratch") return "scratch";
    if (["fleeting", "developing", "permanent", "exported"].includes(currentView)) return "note";
    if (["active", "done"].includes(currentView)) return "todo";
    if (currentView === "draft") return "scratch";
    return undefined;
  })();

  // Show triage toggle when viewing fleeting notes
  const isFleetingView =
    currentView === "fleeting" || (currentView === "notes" && noteSubView === "fleeting");
  const isTriageActive = isFleetingView && triageMode;

  return (
    <AppContext.Provider value={appContextValue}>
      <div className="h-screen flex flex-col md:flex-row overflow-hidden">
        <OfflineIndicator />
        <InstallPrompt />

        {/* Desktop Sidebar */}
        <div className="hidden md:flex">
          <Sidebar />
        </div>

        {/* Main content area */}
        <div className="flex-1 flex flex-col md:flex-row min-w-0 overflow-hidden">
          {currentView === "dashboard" ? (
            /* Dashboard takes full width */
            <ErrorBoundary>
              <Suspense fallback={<LoadingFallback />}>
                <Dashboard
                  onSelectItem={(item) => {
                    setNavStack((prev) => [...prev, { view: "dashboard", itemId: null }]);
                    setCurrentView("all");
                    setSelectedItem(item);
                  }}
                />
              </Suspense>
            </ErrorBoundary>
          ) : currentView === "settings" ? (
            /* Settings takes full width */
            <ErrorBoundary>
              <Suspense fallback={<LoadingFallback />}>
                <Settings onSettingsChanged={refreshConfig} />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <>
              {/* List panel */}
              <div
                className={`flex-1 flex flex-col min-w-0 overflow-hidden ${
                  selectedItem ? "hidden md:flex" : "flex"
                } md:w-96 md:max-w-none md:flex-none md:border-r`}
              >
                <QuickCapture onCreated={refresh} />

                {/* Triage toggle for fleeting view */}
                {isFleetingView && (
                  <div className="flex border-b">
                    <Button
                      variant="ghost"
                      className={`flex-1 rounded-none gap-1.5 ${!triageMode ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
                      onClick={() => setTriageMode(false)}
                    >
                      <List className="h-4 w-4" />
                      列表
                    </Button>
                    <Button
                      variant="ghost"
                      className={`flex-1 rounded-none gap-1.5 ${triageMode ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
                      onClick={() => setTriageMode(true)}
                    >
                      <ListTodo className="h-4 w-4" />
                      整理
                    </Button>
                  </div>
                )}

                {isTriageActive ? (
                  <div className="flex-1 overflow-y-auto">
                    <ErrorBoundary>
                      <Suspense fallback={<LoadingFallback />}>
                        <FleetingTriage onDone={() => setTriageMode(false)} />
                      </Suspense>
                    </ErrorBoundary>
                  </div>
                ) : currentView === "search" ? (
                  <div className="flex-1 overflow-y-auto p-3 md:hidden">
                    <SearchBar onSelect={handleSelect} />
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto">
                    <ItemList
                      status={statusFilter}
                      type={typeFilter}
                      selectedId={selectedItem?.id}
                      noteSubView={noteSubView}
                      todoSubView={todoSubView}
                      onNoteSubViewChange={setNoteSubView}
                      onTodoSubViewChange={setTodoSubView}
                    />
                  </div>
                )}
              </div>

              {/* Detail panel */}
              {selectedItem && (
                <div className="fixed inset-0 z-50 bg-background md:static md:z-auto md:flex-1 md:min-w-0 md:border-l">
                  <ErrorBoundary>
                    <Suspense fallback={<LoadingFallback />}>
                      <ItemDetail
                        itemId={selectedItem.id}
                        onUpdated={refresh}
                        onDeleted={() => {
                          setSelectedItem(null);
                          setNavStack([]);
                          refresh();
                        }}
                      />
                    </Suspense>
                  </ErrorBoundary>
                </div>
              )}

              {/* Empty state for desktop when no item selected */}
              {!selectedItem && !isTriageActive && currentView !== "search" && (
                <div className="hidden md:flex flex-1 items-center justify-center text-muted-foreground">
                  <p>選擇一個項目以查看詳情</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Mobile Bottom Nav - hidden when detail panel is open */}
        {!selectedItem && <BottomNav />}
      </div>
    </AppContext.Provider>
  );
}

export default function App() {
  return (
    <>
      <AuthGate>
        <MainApp />
      </AuthGate>
      <Toaster position="top-center" richColors />
    </>
  );
}
