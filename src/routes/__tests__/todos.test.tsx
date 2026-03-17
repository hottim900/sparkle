import { screen } from "@testing-library/react";
import { renderWithContext } from "@/test-utils";

// --- Mocks ---

const mockMatchRoute = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: React.FC }) => ({
    ...opts,
  }),
  useMatchRoute: () => mockMatchRoute,
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

import { Route } from "@/routes/_list/todos";

const TodosLayout = Route.component!;

beforeEach(() => {
  vi.clearAllMocks();
  mockMatchRoute.mockReturnValue(false);
});

describe("TodosLayout", () => {
  it("renders 2 status chips", () => {
    renderWithContext(<TodosLayout />);

    expect(screen.getByText("進行中")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });

  it("each chip has correct to path", () => {
    renderWithContext(<TodosLayout />);

    const active = screen.getByText("進行中").closest("a");
    expect(active).toHaveAttribute("href", "/todos");

    const done = screen.getByText("已完成").closest("a");
    expect(done).toHaveAttribute("href", "/todos/done");
  });

  it("renders Outlet for child routes", () => {
    renderWithContext(<TodosLayout />);

    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });
});
