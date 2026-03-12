import { createFileRoute } from "@tanstack/react-router";
import { ItemList } from "@/components/item-list";

function DevelopingPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <ItemList type="note" status="developing" />
    </div>
  );
}

export const Route = createFileRoute("/_list/notes/developing")({
  component: DevelopingPage,
});
