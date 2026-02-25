import { useState, useCallback, useMemo, useEffect } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Toaster } from "@/components/ui/sonner";
import { QuickCapture } from "@/components/quick-capture";
import { ItemList } from "@/components/item-list";
import { ItemDetail } from "@/components/item-detail";
import { FleetingTriage } from "@/components/fleeting-triage";
import { Dashboard } from "@/components/dashboard";
import { SearchBar } from "@/components/search-bar";
import { Sidebar } from "@/components/sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { OfflineIndicator } from "@/components/offline-indicator";
import { InstallPrompt } from "@/components/install-prompt";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { getConfig, getItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { List, ListTodo } from "lucide-react";
import { parseItem, type ViewType, type ParsedItem, type ItemStatus, type ItemType } from "@/lib/types";

const isMobile = () => window.innerWidth < 768;

function MainApp() {
  const [currentView, setCurrentView] = useState<ViewType>(
    isMobile() ? "notes" : "dashboard"
  );
  const [selectedItem, setSelectedItem] = useState<ParsedItem | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [triageMode, setTriageMode] = useState(false);
  const [obsidianEnabled, setObsidianEnabled] = useState(false);

  // Sub-navigation state for notes and todos views
  const [noteSubView, setNoteSubView] = useState<"fleeting" | "developing" | "permanent" | "exported">("fleeting");
  const [todoSubView, setTodoSubView] = useState<"active" | "done">("active");

  // Load config on mount
  useEffect(() => {
    getConfig()
      .then((config) => setObsidianEnabled(config.obsidian_export_enabled))
      .catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleSelect = (item: ParsedItem) => {
    setSelectedItem(item);
  };

  const handleViewChange = (view: ViewType) => {
    setCurrentView(view);
    setSelectedItem(null);
    setSelectedTag(undefined);
    setTriageMode(false);
  };

  const handleNavigate = useCallback(async (itemId: string) => {
    try {
      const itemData = await getItem(itemId);
      setSelectedItem(parseItem(itemData));
    } catch {
      // item may have been deleted
    }
  }, []);

  const keyboardHandlers = useMemo(
    () => ({
      onNewItem: () => {
        const input = document.querySelector<HTMLInputElement>(
          'input[placeholder="快速記錄..."]'
        );
        input?.focus();
      },
      onSearch: () => {
        const input = document.querySelector<HTMLInputElement>(
          'input[placeholder="搜尋..."]'
        );
        input?.focus();
      },
      onClose: () => {
        setSelectedItem(null);
      },
    }),
    []
  );

  useKeyboardShortcuts(keyboardHandlers);

  // Map view to status filter (for direct status views)
  const statusFilter: ItemStatus | undefined = (() => {
    const directStatusViews: ViewType[] = [
      "fleeting", "developing", "permanent", "exported",
      "active", "done", "archived",
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
    if (["fleeting", "developing", "permanent", "exported"].includes(currentView)) return "note";
    if (["active", "done"].includes(currentView)) return "todo";
    return undefined;
  })();

  // Show triage toggle when viewing fleeting notes
  const isFleetingView =
    (currentView === "fleeting") ||
    (currentView === "notes" && noteSubView === "fleeting");
  const isTriageActive = isFleetingView && triageMode;

  return (
    <div className="h-screen flex flex-col md:flex-row overflow-hidden">
      <OfflineIndicator />
      <InstallPrompt />

      {/* Desktop Sidebar */}
      <div className="hidden md:flex">
        <Sidebar
          currentView={currentView}
          onViewChange={handleViewChange}
          selectedTag={selectedTag}
          onTagSelect={setSelectedTag}
          onSearchSelect={handleSelect}
        />
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col md:flex-row min-w-0 overflow-hidden">
        {currentView === "dashboard" ? (
          /* Dashboard takes full width */
          <Dashboard
            onViewChange={handleViewChange}
            onSelectItem={(item) => {
              handleSelect(item);
              handleViewChange("all");
            }}
          />
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
                  <FleetingTriage onDone={() => setTriageMode(false)} />
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
                    tag={selectedTag}
                    selectedId={selectedItem?.id}
                    onSelect={handleSelect}
                    refreshKey={refreshKey}
                    currentView={currentView}
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
              <div className="fixed inset-0 z-50 bg-background md:static md:z-auto md:flex-1 md:border-l">
                <ItemDetail
                  itemId={selectedItem.id}
                  obsidianEnabled={obsidianEnabled}
                  onClose={() => setSelectedItem(null)}
                  onUpdated={refresh}
                  onDeleted={() => {
                    setSelectedItem(null);
                    refresh();
                  }}
                  onNavigate={handleNavigate}
                />
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
      {!selectedItem && (
        <BottomNav currentView={currentView} onViewChange={handleViewChange} />
      )}
    </div>
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
