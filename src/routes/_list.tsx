import { Suspense } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { QuickCapture } from "@/components/quick-capture";
import { ItemDetail } from "@/components/item-detail";
import { ErrorBoundary } from "@/components/error-boundary";
import { LoadingFallback } from "@/components/loading-fallback";
import { listSearchSchema } from "@/lib/search-params";

function ListLayout() {
  const { item: selectedId } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <>
      {/* List panel */}
      <div
        className={`flex-1 flex flex-col min-w-0 overflow-hidden ${
          selectedId ? "hidden md:flex" : "flex"
        } md:w-96 md:max-w-none md:flex-none md:border-r`}
      >
        <QuickCapture />
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </div>

      {/* Detail panel */}
      {selectedId && (
        <div className="fixed inset-0 z-50 bg-background md:static md:z-auto md:flex-1 md:min-w-0 md:border-l">
          <ErrorBoundary>
            <Suspense fallback={<LoadingFallback />}>
              <ItemDetail
                itemId={selectedId}
                onDeleted={() => {
                  navigate({ search: (prev) => ({ ...prev, item: undefined }) });
                }}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}

      {/* Empty state for desktop when no item selected */}
      {!selectedId && (
        <div className="hidden md:flex flex-1 items-center justify-center text-muted-foreground">
          <p>選擇一個項目以查看詳情</p>
        </div>
      )}
    </>
  );
}

export const Route = createFileRoute("/_list")({
  validateSearch: (search: Record<string, unknown>) => listSearchSchema.parse(search),
  component: ListLayout,
});
