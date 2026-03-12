import { createFileRoute } from "@tanstack/react-router";
import { ItemList } from "@/components/item-list";

function PermanentPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <ItemList type="note" status="permanent" />
    </div>
  );
}

export const Route = createFileRoute("/_list/notes/permanent")({
  component: PermanentPage,
});
