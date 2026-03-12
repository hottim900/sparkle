import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_list/notes/")({
  beforeLoad: () => {
    throw redirect({ to: "/notes/fleeting" });
  },
});
