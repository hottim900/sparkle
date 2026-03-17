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

import { Route } from "@/routes/_list/notes";

const NotesLayout = Route.component!;

beforeEach(() => {
  vi.clearAllMocks();
  mockMatchRoute.mockReturnValue(false);
});

describe("NotesLayout", () => {
  it("renders 4 status chips", () => {
    renderWithContext(<NotesLayout />);

    expect(screen.getByText("閃念")).toBeInTheDocument();
    expect(screen.getByText("發展中")).toBeInTheDocument();
    expect(screen.getByText("永久筆記")).toBeInTheDocument();
    expect(screen.getByText("已匯出")).toBeInTheDocument();
  });

  it("each chip has correct to path", () => {
    renderWithContext(<NotesLayout />);

    const fleeting = screen.getByText("閃念").closest("a");
    expect(fleeting).toHaveAttribute("href", "/notes/fleeting");

    const developing = screen.getByText("發展中").closest("a");
    expect(developing).toHaveAttribute("href", "/notes/developing");

    const permanent = screen.getByText("永久筆記").closest("a");
    expect(permanent).toHaveAttribute("href", "/notes/permanent");

    const exported = screen.getByText("已匯出").closest("a");
    expect(exported).toHaveAttribute("href", "/notes/exported");
  });

  it("renders Outlet for child routes", () => {
    renderWithContext(<NotesLayout />);

    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });
});
