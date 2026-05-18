import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  Outlet,
} from "@tanstack/react-router";
import { WikilinkChip } from "../wikilink-text";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    resolveWikilink: vi.fn(),
  };
});

import { resolveWikilink } from "@/lib/api";
const mockResolve = resolveWikilink as unknown as ReturnType<typeof vi.fn>;

function renderWithRouter(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => ui,
  });
  const itemRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/item/$id",
    component: () => <div>item</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, itemRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("WikilinkChip", () => {
  beforeEach(() => {
    mockResolve.mockReset();
  });

  it("renders unresolved (purple) when resolver returns null", async () => {
    mockResolve.mockResolvedValue(null);
    renderWithRouter(<WikilinkChip title="NoSuch" />);
    await waitFor(() => expect(screen.getByTestId("wikilink-unresolved")).toBeInTheDocument());
    expect(screen.getByTestId("wikilink-unresolved")).toHaveTextContent("[[NoSuch]]");
  });

  it("renders resolved link with title text", async () => {
    mockResolve.mockResolvedValue({
      id: "abc",
      title: "Foo",
      origin: "active",
      snippet: "preview",
    });
    renderWithRouter(<WikilinkChip title="Foo" />);
    await waitFor(() => expect(screen.getByTestId("wikilink-resolved")).toBeInTheDocument());
    expect(screen.getByTestId("wikilink-resolved")).toHaveTextContent("Foo");
  });

  it("renders alias instead of title when provided", async () => {
    mockResolve.mockResolvedValue({
      id: "abc",
      title: "RealTitle",
      origin: "active",
      snippet: "",
    });
    renderWithRouter(<WikilinkChip title="RealTitle" alias="display" />);
    await waitFor(() => expect(screen.getByTestId("wikilink-resolved")).toBeInTheDocument());
    expect(screen.getByTestId("wikilink-resolved")).toHaveTextContent("display");
  });

  it("data-origin attribute reflects vault vs active source", async () => {
    mockResolve.mockResolvedValue({
      id: "abc",
      title: "VaultDoc",
      origin: "vault",
      snippet: "",
    });
    renderWithRouter(<WikilinkChip title="VaultDoc" />);
    await waitFor(() => expect(screen.getByTestId("wikilink-resolved")).toBeInTheDocument());
    expect(screen.getByTestId("wikilink-resolved")).toHaveAttribute("data-origin", "vault");
  });

  it("renders mobile peek button on non-hover devices (DES-2)", async () => {
    // jsdom's matchMedia stub returns matches:false by default — the hook
    // reads `(hover: hover)` and goes into mobile mode.
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    mockResolve.mockResolvedValue({
      id: "abc",
      title: "MobileTest",
      origin: "active",
      snippet: "snippet",
    });
    renderWithRouter(<WikilinkChip title="MobileTest" />);
    await waitFor(() => expect(screen.getByTestId("wikilink-resolved-mobile")).toBeInTheDocument());
    expect(screen.getByTestId("wikilink-mobile-peek")).toBeInTheDocument();
    // Link still navigates on tap (primary action)
    expect(screen.getByTestId("wikilink-resolved")).toHaveAttribute("href", "/item/abc");
  });

  it("does NOT render mobile peek on hover-capable devices", async () => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: true,
      media: q,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    mockResolve.mockResolvedValue({
      id: "abc",
      title: "Desktop",
      origin: "active",
      snippet: "",
    });
    renderWithRouter(<WikilinkChip title="Desktop" />);
    await waitFor(() => expect(screen.getByTestId("wikilink-resolved")).toBeInTheDocument());
    expect(screen.queryByTestId("wikilink-mobile-peek")).not.toBeInTheDocument();
  });
});
