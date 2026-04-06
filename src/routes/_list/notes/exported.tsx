import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_list/notes/exported")({
  beforeLoad: () => {
    throw redirect({
      to: "/vault",
      search: { filter: "sparkle", file: undefined },
    });
  },
});
