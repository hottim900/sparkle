import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

const todoChips = [
  { to: "/todos" as const, label: "進行中", exact: true },
  { to: "/todos/done" as const, label: "已完成", exact: false },
];

function TodosLayout() {
  const matchRoute = useMatchRoute();

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex gap-1 px-3 py-2 border-b overflow-x-auto">
        {todoChips.map((chip) => {
          // For the index route (/todos), use exact matching to avoid matching /todos/done
          const isActive = chip.exact
            ? matchRoute({ to: chip.to }) && !matchRoute({ to: "/todos/done" })
            : matchRoute({ to: chip.to });
          return (
            <Button
              key={chip.to}
              size="sm"
              variant={isActive ? "default" : "outline"}
              className="h-7 text-xs shrink-0"
              asChild
            >
              <Link to={chip.to} search={(prev) => ({ ...prev, item: undefined })}>
                {chip.label}
              </Link>
            </Button>
          );
        })}
      </div>
      <Outlet />
    </div>
  );
}

export const Route = createFileRoute("/_list/todos")({
  component: TodosLayout,
});
