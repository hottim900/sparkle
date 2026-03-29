import { createFileRoute } from "@tanstack/react-router";
import { PausedItemList } from "@/components/paused-item-list";

function PausedPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <PausedItemList />
    </div>
  );
}

export const Route = createFileRoute("/_list/paused")({
  component: PausedPage,
});
