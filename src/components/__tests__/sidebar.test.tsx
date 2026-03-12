import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithContext } from "@/test-utils";
import { Sidebar } from "../sidebar";

const mockGetTags = vi.fn();
const mockClearToken = vi.fn();

vi.mock("@/lib/api", () => ({
  getTags: (...args: unknown[]) => mockGetTags(...args),
  clearToken: (...args: unknown[]) => mockClearToken(...args),
}));

vi.mock("../search-bar", () => ({
  SearchBar: ({ onSelect }: { onSelect: unknown }) => (
    <div data-testid="search-bar" data-onselect={typeof onSelect} />
  ),
}));

const mockNavigate = vi.fn();
let mockPathname = "/notes/fleeting";
let mockSearchParams: Record<string, unknown> = {};

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: mockPathname, search: mockSearchParams } }),
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    [key: string]: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTags.mockResolvedValue({ tags: [] });
  mockPathname = "/notes/fleeting";
  mockSearchParams = {};
});

describe("Sidebar", () => {
  it("renders navigation groups", () => {
    renderWithContext(<Sidebar />);

    expect(screen.getByText("筆記")).toBeInTheDocument();
    expect(screen.getByText("待辦")).toBeInTheDocument();
    expect(screen.getByText("暫存")).toBeInTheDocument();
    expect(screen.getByText("共用")).toBeInTheDocument();
  });

  it("renders navigation items", () => {
    renderWithContext(<Sidebar />);

    expect(screen.getByText("總覽")).toBeInTheDocument();
    expect(screen.getByText("閃念")).toBeInTheDocument();
    expect(screen.getByText("發展中")).toBeInTheDocument();
    expect(screen.getByText("永久筆記")).toBeInTheDocument();
    expect(screen.getByText("已匯出")).toBeInTheDocument();
    expect(screen.getByText("進行中")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("暫存區")).toBeInTheDocument();
    expect(screen.getByText("全部")).toBeInTheDocument();
    expect(screen.getByText("已封存")).toBeInTheDocument();
    expect(screen.getByText("分享管理")).toBeInTheDocument();
    expect(screen.getByText("設定")).toBeInTheDocument();
    expect(screen.getByText("登出")).toBeInTheDocument();
  });

  it("nav items are links to correct paths", () => {
    renderWithContext(<Sidebar />);

    const fleetingLink = screen.getByText("閃念").closest("a");
    expect(fleetingLink).toHaveAttribute("href", "/notes/fleeting");

    const todosLink = screen.getByText("進行中").closest("a");
    expect(todosLink).toHaveAttribute("href", "/todos");
  });

  it("renders tags from API", async () => {
    mockGetTags.mockResolvedValue({ tags: ["idea", "project", "reading"] });
    renderWithContext(<Sidebar />);

    await waitFor(() => {
      expect(screen.getByText("idea")).toBeInTheDocument();
      expect(screen.getByText("project")).toBeInTheDocument();
      expect(screen.getByText("reading")).toBeInTheDocument();
    });
  });

  it("clicking a tag calls navigate with tag param", async () => {
    const user = userEvent.setup();
    mockGetTags.mockResolvedValue({ tags: ["idea"] });
    renderWithContext(<Sidebar />);

    await waitFor(() => {
      expect(screen.getByText("idea")).toBeInTheDocument();
    });

    await user.click(screen.getByText("idea"));
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: { tag: "idea", item: undefined },
      }),
    );
  });

  it("clicking an already-selected tag deselects it", async () => {
    const user = userEvent.setup();
    mockGetTags.mockResolvedValue({ tags: ["idea"] });
    mockSearchParams = { tag: "idea" };
    renderWithContext(<Sidebar />);

    await waitFor(() => {
      expect(screen.getByText("idea")).toBeInTheDocument();
    });

    await user.click(screen.getByText("idea"));
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: { tag: undefined, item: undefined },
      }),
    );
  });

  it("settings link points to /settings", () => {
    renderWithContext(<Sidebar />);

    const settingsLink = screen.getByText("設定").closest("a");
    expect(settingsLink).toHaveAttribute("href", "/settings");
  });

  it("clicking 登出 calls clearToken and reloads", async () => {
    const user = userEvent.setup();
    const reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      value: { reload: reloadMock },
      writable: true,
    });

    renderWithContext(<Sidebar />);

    await user.click(screen.getByText("登出"));
    expect(mockClearToken).toHaveBeenCalled();
    expect(reloadMock).toHaveBeenCalled();
  });

  it("includes search bar", () => {
    renderWithContext(<Sidebar />);
    expect(screen.getByTestId("search-bar")).toBeInTheDocument();
  });
});
