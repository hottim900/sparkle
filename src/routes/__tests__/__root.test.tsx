import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- Mocks ---

const mockNavigate = vi.fn();
let mockSearchParams: Record<string, unknown> = {};
let mockPathname = "/notes/fleeting";

vi.mock("@tanstack/react-router", () => ({
  createRootRoute: (opts: { component: React.FC }) => ({
    ...opts,
    useSearch: () => mockSearchParams,
    useNavigate: () => mockNavigate,
  }),
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: mockPathname, search: mockSearchParams } }),
  Link: ({
    children,
    to,
    className,
  }: {
    children: React.ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="outlet" />,
}));

vi.mock("@/components/sidebar", () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

vi.mock("@/components/bottom-nav", () => ({
  BottomNav: ({ onSearchClick }: { onSearchClick?: () => void }) => (
    <div data-testid="bottom-nav" onClick={onSearchClick} />
  ),
}));

vi.mock("@/components/offline-indicator", () => ({
  OfflineIndicator: () => <div data-testid="offline-indicator" />,
}));

vi.mock("@/components/install-prompt", () => ({
  InstallPrompt: () => <div data-testid="install-prompt" />,
}));

vi.mock("@/components/search-bar", () => ({
  SearchBar: () => <div data-testid="search-bar" />,
}));

vi.mock("@/components/loading-fallback", () => ({
  LoadingFallback: () => <div data-testid="loading-fallback" />,
}));

vi.mock("@/hooks/use-online-status", () => ({
  useOnlineStatus: () => true,
}));

const mockGetConfig = vi.fn();
vi.mock("@/lib/api", () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

// Import after mocks are set up (hoisting ensures mocks are applied)
import { Route } from "@/routes/__root";

const RootLayout = Route.component!;

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams = {};
  mockPathname = "/notes/fleeting";
  mockGetConfig.mockResolvedValue({ obsidian_export_enabled: false });
});

function renderRoot() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RootLayout />
    </QueryClientProvider>,
  );
}

describe("RootLayout", () => {
  it("renders without crash", () => {
    renderRoot();

    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-nav")).toBeInTheDocument();
    expect(screen.getByTestId("offline-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });

  it("Escape key calls navigate with item: undefined", async () => {
    const user = userEvent.setup();
    renderRoot();

    await user.keyboard("{Escape}");

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.any(Function) }),
    );
    const searchFn = mockNavigate.mock.calls[0][0].search;
    expect(searchFn({ item: "some-id", tag: "idea" })).toEqual({
      item: undefined,
      tag: "idea",
    });
  });

  it("hides bottom nav when item selected on list route", () => {
    mockSearchParams = { item: "abc-123" };
    mockPathname = "/notes/fleeting";
    renderRoot();

    expect(screen.queryByTestId("bottom-nav")).not.toBeInTheDocument();
  });

  it("shows bottom nav when no item selected", () => {
    mockSearchParams = {};
    mockPathname = "/notes/fleeting";
    renderRoot();

    expect(screen.getByTestId("bottom-nav")).toBeInTheDocument();
  });

  it("shows bottom nav when item selected on non-list route", () => {
    mockSearchParams = { item: "abc-123" };
    mockPathname = "/settings";
    renderRoot();

    expect(screen.getByTestId("bottom-nav")).toBeInTheDocument();
  });
});
