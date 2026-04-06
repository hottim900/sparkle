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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <button
          onClick={() => navigate({ to: "/vault", search: { file: undefined, filter: undefined } })}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          回到 Vault
        </button>
        <ItemDetail
          itemId={itemId}
          onBack={() => navigate({ to: "/vault", search: { file: undefined, filter: undefined } })}
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
