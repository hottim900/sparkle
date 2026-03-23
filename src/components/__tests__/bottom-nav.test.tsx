import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithContext } from "@/test-utils";
import { BottomNav } from "../bottom-nav";

let mockPathname = "/notes/fleeting";

vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: mockPathname, search: {} } }),
  Link: ({
    children,
    to,
    className,
    onClick,
  }: {
    children: React.ReactNode;
    to: string;
    className?: string;
    onClick?: () => void;
  }) => (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockPathname = "/notes/fleeting";
});

describe("BottomNav", () => {
  it("renders 5 main nav tabs plus more button", () => {
    renderWithContext(<BottomNav />);

    expect(screen.getByText("筆記")).toBeInTheDocument();
    expect(screen.getByText("待辦")).toBeInTheDocument();
    expect(screen.getByText("暫存")).toBeInTheDocument();
    expect(screen.getByText("儀表板")).toBeInTheDocument();
    expect(screen.getByText("搜尋")).toBeInTheDocument();
    expect(screen.getByText("更多")).toBeInTheDocument();
  });

  it("highlights the current view tab", () => {
    mockPathname = "/todos";
    renderWithContext(<BottomNav />);

    const todosLink = screen.getByText("待辦").closest("a")!;
    expect(todosLink.className).toContain("text-primary");

    const notesLink = screen.getByText("筆記").closest("a")!;
    expect(notesLink.className).toContain("text-muted-foreground");
  });

  it("nav items link to correct paths", () => {
    renderWithContext(<BottomNav />);

    const scratchLink = screen.getByText("暫存").closest("a");
    expect(scratchLink).toHaveAttribute("href", "/scratch");
  });

  it("opens more menu when clicking 更多", async () => {
    const user = userEvent.setup();
    renderWithContext(<BottomNav />);

    expect(screen.queryByText("全部")).not.toBeInTheDocument();

    await user.click(screen.getByText("更多"));

    expect(screen.getByText("私密筆記")).toBeInTheDocument();
    expect(screen.getByText("全部")).toBeInTheDocument();
    expect(screen.getByText("已封存")).toBeInTheDocument();
    expect(screen.getByText("分享管理")).toBeInTheDocument();
    expect(screen.getByText("設定")).toBeInTheDocument();
  });

  it("clicking a more menu item closes menu", async () => {
    const user = userEvent.setup();
    renderWithContext(<BottomNav />);

    await user.click(screen.getByText("更多"));
    await user.click(screen.getByText("設定"));

    expect(screen.queryByText("全部")).not.toBeInTheDocument();
  });

  it("closes more menu when clicking overlay", async () => {
    const user = userEvent.setup();
    renderWithContext(<BottomNav />);

    await user.click(screen.getByText("更多"));
    expect(screen.getByText("全部")).toBeInTheDocument();

    // Click the overlay to close
    await user.click(screen.getByTestId("more-overlay"));

    expect(screen.queryByText("全部")).not.toBeInTheDocument();
  });

  it.each(["/settings", "/private"])("highlights 更多 button when on %s", (path) => {
    mockPathname = path;
    renderWithContext(<BottomNav />);

    const moreButton = screen.getByText("更多").closest("button")!;
    expect(moreButton.className).toContain("text-primary");
  });
});
