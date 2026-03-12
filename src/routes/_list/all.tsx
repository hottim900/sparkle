import { createFileRoute } from "@tanstack/react-router";
import { ItemList } from "@/components/item-list";

function AllPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <ItemList />
    </div>
  );
}

export const Route = createFileRoute("/_list/all")({
  component: AllPage,
});
