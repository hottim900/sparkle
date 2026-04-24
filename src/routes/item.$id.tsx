import { useCallback } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { getItem } from "@/lib/api";
import { toast } from "sonner";
import { LoadingFallback } from "@/components/loading-fallback";
import { ItemDetail } from "@/components/item-detail";
import { ArrowLeft } from "lucide-react";
import type { Item } from "@/lib/types";

export function getTargetPath(item: Item): string | null {
  const { type, status } = item;

  if (type === "note") {
    switch (status) {
      case "fleeting":
        return "/notes/fleeting";
      case "developing":
        return "/notes/developing";
      case "permanent":
        return "/notes/permanent";
      case "exported":
        return null; // standalone detail view
      case "archived":
        return "/archived";
    }
  }

  if (type === "todo") {
    switch (status) {
      case "active":
        return "/todos";
      case "done":
        return "/todos/done";
      case "archived":
        return "/archived";
    }
  }

  if (type === "scratch") {
    switch (status) {
      case "draft":
        return "/scratch";
      case "archived":
        return "/archived";
    }
  }

  return "/dashboard";
}

function ExportedItemView({ itemId }: { itemId: string }) {
  const navigate = useNavigate();

  const navigateToVault = useCallback(
    () => navigate({ to: "/vault", search: { file: undefined, filter: undefined } }),
    [navigate],
  );

  // After release we redirect to /notes (per design): the user just returned a
  // vault row to Sparkle's active-note surface area, so landing them on the
  // notes list is the natural follow-up. We then focus the H1 for keyboard
  // users — a short timeout lets the new route mount first (h1 is made
  // focusable via tabindex=-1 at its usage site or via the querySelector).
  const onReleased = useCallback(() => {
    navigate({ to: "/notes/fleeting" });
    setTimeout(() => {
      const h1 = document.querySelector<HTMLElement>("main h1, h1");
      if (h1) {
        if (!h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
        h1.focus({ preventScroll: false });
      }
    }, 80);
  }, [navigate]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <button
          onClick={navigateToVault}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          回到 Vault
        </button>
        <ItemDetail
          itemId={itemId}
          onBack={navigateToVault}
          onDeleted={onReleased}
          onNavigate={(linkedId) => navigate({ to: "/item/$id", params: { id: linkedId } })}
        />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/item/$id")({
  loader: async ({ params }) => {
    try {
      const item = await getItem(params.id);
      const targetPath = getTargetPath(item);

      if (targetPath) {
        throw redirect({
          to: targetPath,
          search: { item: params.id },
        });
      }

      // Exported items: render standalone view
      return { item };
    } catch (error) {
      if (error instanceof Response) {
        throw error;
      }
      toast.error("找不到此項目");
      throw redirect({ to: "/dashboard" });
    }
  },
  pendingComponent: () => (
    <div className="flex-1 flex items-center justify-center">
      <LoadingFallback />
    </div>
  ),
  component: ItemResolverPage,
});

function ItemResolverPage() {
  const { item } = Route.useLoaderData();
  return <ExportedItemView itemId={item.id} />;
}
