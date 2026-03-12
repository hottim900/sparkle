import { createFileRoute } from "@tanstack/react-router";
import { ItemList } from "@/components/item-list";

function ArchivedPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <ItemList status="archived" />
    </div>
  );
}

export const Route = createFileRoute("/_list/archived")({
  component: ArchivedPage,
});
