import { createFileRoute, redirect } from "@tanstack/react-router";
import { rootSearchSchema } from "@/lib/search-params";

export const Route = createFileRoute("/all")({
  validateSearch: rootSearchSchema,
  beforeLoad: ({ search }) => {
    if (search.item) {
      throw redirect({ to: "/item/$id", params: { id: search.item }, replace: true });
    }
    throw redirect({ to: "/dashboard", replace: true });
  },
});
