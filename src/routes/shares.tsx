import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ErrorBoundary } from "@/components/error-boundary";
import { ShareManagement } from "@/components/share-management";

function SharesPage() {
  const navigate = useNavigate();

  return (
    <ErrorBoundary>
      <ShareManagement
        onNavigateToItem={(itemId) => {
          navigate({ to: "/item/$id", params: { id: itemId } });
        }}
      />
    </ErrorBoundary>
  );
}

export const Route = createFileRoute("/shares")({
  component: SharesPage,
});
