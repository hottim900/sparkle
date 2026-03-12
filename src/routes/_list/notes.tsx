import { createFileRoute, Link, Outlet, useMatchRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

const noteChips = [
  { to: "/notes/fleeting" as const, label: "閃念" },
  { to: "/notes/developing" as const, label: "發展中" },
  { to: "/notes/permanent" as const, label: "永久筆記" },
  { to: "/notes/exported" as const, label: "已匯出" },
];

function NotesLayout() {
  const matchRoute = useMatchRoute();

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex gap-1 px-3 py-2 border-b overflow-x-auto">
        {noteChips.map((chip) => {
          const isActive = matchRoute({ to: chip.to, fuzzy: true });
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

export const Route = createFileRoute("/_list/notes")({
  component: NotesLayout,
});
