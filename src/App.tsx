import { useState, useCallback } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Toaster } from "@/components/ui/sonner";
import { QuickCapture } from "@/components/quick-capture";
import { ItemList } from "@/components/item-list";
import { ItemDetail } from "@/components/item-detail";
import { InboxTriage } from "@/components/inbox-triage";
import { SearchBar } from "@/components/search-bar";
import { Sidebar } from "@/components/sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { OfflineIndicator } from "@/components/offline-indicator";
import type { ViewType, ParsedItem, ItemStatus } from "@/lib/types";

function MainApp() {
  const [currentView, setCurrentView] = useState<ViewType>("inbox");
  const [selectedItem, setSelectedItem] = useState<ParsedItem | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);

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
  };

  // Map view to status filter
  const statusFilter: ItemStatus | undefined =
    currentView === "all" || currentView === "triage" || currentView === "search"
      ? undefined
      : (currentView as ItemStatus);

  return (
    <div className="h-screen flex flex-col md:flex-row overflow-hidden">
      <OfflineIndicator />

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
        {/* List panel */}
        <div
          className={`flex-1 flex flex-col min-w-0 overflow-hidden ${
            selectedItem ? "hidden md:flex" : "flex"
          } ${selectedItem ? "md:max-w-sm md:border-r" : ""}`}
        >
          <QuickCapture onCreated={refresh} />

          {currentView === "triage" ? (
            <div className="flex-1 overflow-y-auto">
              <InboxTriage onDone={() => handleViewChange("inbox")} />
            </div>
          ) : currentView === "search" ? (
            <div className="flex-1 overflow-y-auto p-3 md:hidden">
              <SearchBar onSelect={handleSelect} />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              <ItemList
                status={statusFilter}
                tag={selectedTag}
                selectedId={selectedItem?.id}
                onSelect={handleSelect}
                refreshKey={refreshKey}
              />
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedItem && (
          <div className="fixed inset-0 z-50 bg-background md:static md:z-auto md:flex-1">
            <ItemDetail
              itemId={selectedItem.id}
              onClose={() => setSelectedItem(null)}
              onUpdated={refresh}
              onDeleted={() => {
                setSelectedItem(null);
                refresh();
              }}
            />
          </div>
        )}

        {/* Empty state for desktop when no item selected */}
        {!selectedItem && currentView !== "triage" && currentView !== "search" && (
          <div className="hidden md:flex flex-1 items-center justify-center text-muted-foreground">
            <p>選擇一個項目以查看詳情</p>
          </div>
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
