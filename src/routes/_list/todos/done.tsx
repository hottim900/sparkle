import { createFileRoute } from "@tanstack/react-router";
import { ItemList } from "@/components/item-list";

function DoneTodosPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <ItemList type="todo" status="done" />
    </div>
  );
}

export const Route = createFileRoute("/_list/todos/done")({
  component: DoneTodosPage,
});
