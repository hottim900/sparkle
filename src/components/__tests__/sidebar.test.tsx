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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTags.mockResolvedValue({ tags: [] });
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
    expect(screen.getByText("設定")).toBeInTheDocument();
    expect(screen.getByText("登出")).toBeInTheDocument();
  });

  it("calls onViewChange when clicking a nav item", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    renderWithContext(<Sidebar />, { onViewChange });

    await user.click(screen.getByText("閃念"));
    expect(onViewChange).toHaveBeenCalledWith("fleeting");
  });

  it("clears selectedTag when clicking a nav item", async () => {
    const user = userEvent.setup();
    const onTagSelect = vi.fn();
    renderWithContext(<Sidebar />, { onTagSelect, selectedTag: "test" });

    await user.click(screen.getByText("進行中"));
    expect(onTagSelect).toHaveBeenCalledWith(undefined);
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

  it("clicking a tag calls onTagSelect", async () => {
    const user = userEvent.setup();
    const onTagSelect = vi.fn();
    mockGetTags.mockResolvedValue({ tags: ["idea"] });
    renderWithContext(<Sidebar />, { onTagSelect });

    await waitFor(() => {
      expect(screen.getByText("idea")).toBeInTheDocument();
    });

    await user.click(screen.getByText("idea"));
    expect(onTagSelect).toHaveBeenCalledWith("idea");
  });

  it("clicking an already-selected tag deselects it", async () => {
    const user = userEvent.setup();
    const onTagSelect = vi.fn();
    mockGetTags.mockResolvedValue({ tags: ["idea"] });
    renderWithContext(<Sidebar />, { onTagSelect, selectedTag: "idea" });

    await waitFor(() => {
      expect(screen.getByText("idea")).toBeInTheDocument();
    });

    await user.click(screen.getByText("idea"));
    expect(onTagSelect).toHaveBeenCalledWith(undefined);
  });

  it("clicking 設定 navigates to settings view", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    renderWithContext(<Sidebar />, { onViewChange });

    await user.click(screen.getByText("設定"));
    expect(onViewChange).toHaveBeenCalledWith("settings");
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
