import { createFileRoute } from "@tanstack/react-router";
import { ErrorBoundary } from "@/components/error-boundary";
import { Dashboard } from "@/components/dashboard";

function DashboardPage() {
  return (
    <ErrorBoundary>
      <Dashboard />
    </ErrorBoundary>
  );
}

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});
