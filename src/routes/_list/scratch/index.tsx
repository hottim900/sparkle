import { createFileRoute } from "@tanstack/react-router";
import { ItemList } from "@/components/item-list";

function ScratchPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <ItemList type="scratch" status="draft" />
    </div>
  );
}

export const Route = createFileRoute("/_list/scratch/")({
  component: ScratchPage,
});
