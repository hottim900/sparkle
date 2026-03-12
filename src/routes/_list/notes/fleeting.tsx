import { lazy, Suspense, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ItemList } from "@/components/item-list";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/error-boundary";
import { List, ListTodo, Loader2 } from "lucide-react";

const FleetingTriage = lazy(() =>
  import("@/components/fleeting-triage").then((m) => ({ default: m.FleetingTriage })),
);

function FleetingPage() {
  const [triageMode, setTriageMode] = useState(false);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Triage toggle */}
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

      <div className="flex-1 overflow-y-auto">
        {triageMode ? (
          <ErrorBoundary>
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              }
            >
              <FleetingTriage onDone={() => setTriageMode(false)} />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <ItemList type="note" status="fleeting" />
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_list/notes/fleeting")({
  component: FleetingPage,
});
