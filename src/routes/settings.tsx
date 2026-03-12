import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { ErrorBoundary } from "@/components/error-boundary";
import { Settings } from "@/components/settings";

function SettingsPage() {
  const queryClient = useQueryClient();

  return (
    <ErrorBoundary>
      <Settings
        onSettingsChanged={() => {
          queryClient.invalidateQueries({ queryKey: queryKeys.config });
        }}
      />
    </ErrorBoundary>
  );
}

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});
