import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { AuthGate } from "@/components/auth-gate";
import { Toaster } from "@/components/ui/sonner";
import { createQueryClient } from "@/lib/query-client";

const queryClient = createQueryClient();

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export default function App() {
  return (
    <>
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <RouterProvider router={router} />
        </AuthGate>
      </QueryClientProvider>
      <Toaster position="top-center" richColors />
    </>
  );
}
