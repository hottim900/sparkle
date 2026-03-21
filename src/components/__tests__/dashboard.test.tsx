import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dashboard } from "../dashboard";
import { renderWithContext } from "@/test-utils";
import type { StatsResponse, CategoryDistribution } from "@/lib/types";

const mockGetStats = vi.fn();
const mockGetUnreviewed = vi.fn();
const mockGetRecent = vi.fn();
const mockGetAttention = vi.fn();
const mockGetDashboardStale = vi.fn();
const mockGetCategoryDistribution = vi.fn();

vi.mock("@/lib/api", () => ({
  getStats: (...args: unknown[]) => mockGetStats(...args),
  getUnreviewed: (...args: unknown[]) => mockGetUnreviewed(...args),
  getRecent: (...args: unknown[]) => mockGetRecent(...args),
  getAttention: (...args: unknown[]) => mockGetAttention(...args),
  getDashboardStale: (...args: unknown[]) => mockGetDashboardStale(...args),
  getCategoryDistribution: (...args: unknown[]) => mockGetCategoryDistribution(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

function makeStats(overrides: Partial<StatsResponse> = {}): StatsResponse {
  return {
    fleeting_count: 5,
    developing_count: 3,
    permanent_count: 10,
    exported_this_week: 2,
    exported_this_month: 8,
    active_count: 4,
    done_this_week: 6,
    done_this_month: 15,
    scratch_count: 0,
    created_this_week: 3,
    created_this_month: 12,
    overdue_count: 0,
    ...overrides,
  };
}

function makeDashboardItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    type: "note",
    title: "Test Item",
    content: "",
    status: "fleeting",
    priority: null,
    due: null,
    tags: "[]",
    source: null,
    origin: "mcp",
    aliases: "[]",
    linked_note_id: null,
    linked_note_title: null,
    linked_todo_count: 0,
    share_visibility: null,
    category_id: null,
    category_name: null,
    viewed_at: null,
    created: "2026-03-20T00:00:00Z",
    modified: "2026-03-20T00:00:00Z",
    ...overrides,
  };
}

function makeCategoryDist(overrides: Partial<CategoryDistribution> = {}): CategoryDistribution {
  return {
    category_id: "cat-1",
    category_name: "程式設計",
    color: "#3b82f6",
    count: 10,
    ...overrides,
  };
}

function setupDefaultMocks() {
  mockGetStats.mockResolvedValue(makeStats());
  mockGetUnreviewed.mockResolvedValue({ items: [], total: 0 });
  mockGetRecent.mockResolvedValue({ items: [], total: 0 });
  mockGetAttention.mockResolvedValue({ items: [], total: 0 });
  mockGetDashboardStale.mockResolvedValue({ items: [], total: 0 });
  mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });
}

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Loading ---
  it("shows loading spinner initially", () => {
    mockGetStats.mockReturnValue(new Promise(() => {}));
    mockGetUnreviewed.mockResolvedValue({ items: [], total: 0 });
    mockGetRecent.mockResolvedValue({ items: [], total: 0 });
    mockGetAttention.mockResolvedValue({ items: [], total: 0 });
    mockGetDashboardStale.mockResolvedValue({ items: [], total: 0 });
    mockGetCategoryDistribution.mockReturnValue(new Promise(() => {}));

    renderWithContext(<Dashboard />);
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  // --- Section 1: Dashboard Cards ---
  describe("Dashboard cards section", () => {
    it("shows unreviewed items with type badge", async () => {
      mockGetStats.mockResolvedValue(makeStats());
      mockGetUnreviewed.mockResolvedValue({
        items: [makeDashboardItem({ id: "ur-1", title: "Unreviewed Note", type: "note" })],
        total: 1,
      });
      mockGetRecent.mockResolvedValue({ items: [], total: 0 });
      mockGetAttention.mockResolvedValue({ items: [], total: 0 });
      mockGetDashboardStale.mockResolvedValue({ items: [], total: 0 });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      renderWithContext(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText("Unreviewed Note")).toBeInTheDocument();
      });
      expect(screen.getByText("筆記")).toBeInTheDocument();
    });

    it("shows recent items with relative time", async () => {
      mockGetStats.mockResolvedValue(makeStats());
      mockGetUnreviewed.mockResolvedValue({ items: [], total: 0 });
      mockGetRecent.mockResolvedValue({
        items: [
          makeDashboardItem({
            id: "rc-1",
            title: "Recent Item",
            created: new Date(Date.now() - 3600000).toISOString(),
          }),
        ],
        total: 1,
      });
      mockGetAttention.mockResolvedValue({ items: [], total: 0 });
      mockGetDashboardStale.mockResolvedValue({ items: [], total: 0 });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      renderWithContext(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText("Recent Item")).toBeInTheDocument();
      });
      expect(screen.getByText("1 小時前")).toBeInTheDocument();
    });

    it("shows attention items with overdue badge", async () => {
      mockGetStats.mockResolvedValue(makeStats());
      mockGetUnreviewed.mockResolvedValue({ items: [], total: 0 });
      mockGetRecent.mockResolvedValue({ items: [], total: 0 });
      mockGetAttention.mockResolvedValue({
        items: [
          {
            ...makeDashboardItem({
              id: "at-1",
              title: "Overdue Task",
              type: "todo",
              status: "active",
              due: "2026-03-01",
            }),
            attention_reason: "overdue",
          },
        ],
        total: 1,
      });
      mockGetDashboardStale.mockResolvedValue({ items: [], total: 0 });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      renderWithContext(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText("Overdue Task")).toBeInTheDocument();
      });
      expect(screen.getByText("逾期")).toBeInTheDocument();
    });

    it("shows attention items with high priority badge", async () => {
      mockGetStats.mockResolvedValue(makeStats());
      mockGetUnreviewed.mockResolvedValue({ items: [], total: 0 });
      mockGetRecent.mockResolvedValue({ items: [], total: 0 });
      mockGetAttention.mockResolvedValue({
        items: [
          {
            ...makeDashboardItem({
              id: "at-2",
              title: "High Priority Item",
              priority: "high",
            }),
            attention_reason: "high_priority",
          },
        ],
        total: 1,
      });
      mockGetDashboardStale.mockResolvedValue({ items: [], total: 0 });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      renderWithContext(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText("High Priority Item")).toBeInTheDocument();
      });
      expect(screen.getByText("高優先")).toBeInTheDocument();
    });

    it("shows empty state text when cards have no items", async () => {
      setupDefaultMocks();

      renderWithContext(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText("沒有未處理的項目")).toBeInTheDocument();
      });
      expect(screen.getByText("最近沒有新增項目")).toBeInTheDocument();
      expect(screen.getByText("沒有需要關注的項目")).toBeInTheDocument();
    });

    it("navigates to item route when unreviewed item is clicked", async () => {
      mockGetStats.mockResolvedValue(makeStats());
      mockGetUnreviewed.mockResolvedValue({
        items: [
          makeDashboardItem({
            id: "nav-1",
            title: "Click Me",
            type: "note",
            status: "fleeting",
          }),
        ],
        total: 1,
      });
      mockGetRecent.mockResolvedValue({ items: [], total: 0 });
      mockGetAttention.mockResolvedValue({ items: [], total: 0 });
      mockGetDashboardStale.mockResolvedValue({ items: [], total: 0 });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      const user = userEvent.setup();
      renderWithContext(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText("Click Me")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Click Me"));
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/notes/fleeting",
        search: { item: "nav-1" },
      });
    });

    it("shows stale notes collapsed row", async () => {
      mockGetStats.mockResolvedValue(makeStats());
      mockGetUnreviewed.mockResolvedValue({ items: [], total: 0 });
      mockGetRecent.mockResolvedValue({ items: [], total: 0 });
      mockGetAttention.mockResolvedValue({ items: [], total: 0 });
      mockGetDashboardStale.mockResolvedValue({
        items: [
          {
            id: "stale-1",
            title: "Stale Note",
            category_name: null,
            modified: "2026-03-01T00:00:00Z",
            days_stale: 14,
          },
        ],
        total: 1,
      });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      const user = userEvent.setup();
      renderWithContext(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText(/1 個發展中筆記超過設定天數未更新/)).toBeInTheDocument();
      });

      // Initially collapsed - stale note title not visible
      expect(screen.queryByText("Stale Note")).not.toBeInTheDocument();

      // Click to expand
      await user.click(screen.getByText(/1 個發展中筆記超過設定天數未更新/));
      expect(screen.getByText("Stale Note")).toBeInTheDocument();
      expect(screen.getByText("14 天未更新")).toBeInTheDocument();
    });
  });

  // --- Section 2: Pipeline ---
  describe("Zettelkasten 管道 section", () => {
    it("shows pipeline counts", async () => {
      mockGetStats.mockResolvedValue(
        makeStats({ fleeting_count: 7, developing_count: 4, permanent_count: 20 }),
      );
      mockGetUnreviewed.mockResolvedValue({ items: [], total: 0 });
      mockGetRecent.mockResolvedValue({ items: [], total: 0 });
      mockGetAttention.mockResolvedValue({ items: [], total: 0 });
      mockGetDashboardStale.mockResolvedValue({ items: [], total: 0 });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      renderWithContext(<Dashboard />);

      await waitFor(() => {
        const fleetingCard = screen.getByTestId("pipeline-fleeting");
        expect(within(fleetingCard).getByText("7")).toBeInTheDocument();
      });

      const developingCard = screen.getByTestId("pipeline-developing");
      expect(within(developingCard).getByText("4")).toBeInTheDocument();

      const permanentCard = screen.getByTestId("pipeline-permanent");
      expect(within(permanentCard).getByText("20")).toBeInTheDocument();
    });

    it("shows pipeline labels", async () => {
      setupDefaultMocks();
      renderWithContext(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByTestId("pipeline-fleeting")).toBeInTheDocument();
      });

      expect(within(screen.getByTestId("pipeline-fleeting")).getByText("閃念")).toBeInTheDocument();
      expect(
        within(screen.getByTestId("pipeline-developing")).getByText("發展中"),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("pipeline-permanent")).getByText("永久"),
      ).toBeInTheDocument();
    });

    it("calls navigate to /notes/fleeting when fleeting card is clicked", async () => {
      setupDefaultMocks();
      const user = userEvent.setup();
      renderWithContext(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByTestId("pipeline-fleeting")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("pipeline-fleeting"));
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/notes/fleeting" });
    });

    it("calls navigate to /notes/developing when developing card is clicked", async () => {
      setupDefaultMocks();
      const user = userEvent.setup();
      renderWithContext(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByTestId("pipeline-developing")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("pipeline-developing"));
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/notes/developing" });
    });

    it("calls navigate to /notes/permanent when permanent card is clicked", async () => {
      setupDefaultMocks();
      const user = userEvent.setup();
      renderWithContext(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByTestId("pipeline-permanent")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("pipeline-permanent"));
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/notes/permanent" });
    });
  });

  // --- Section 3: Monthly Summary ---
  describe("本月活動 section", () => {
    it("shows monthly summary numbers", async () => {
      mockGetStats.mockResolvedValue(
        makeStats({ created_this_month: 25, done_this_month: 18, exported_this_month: 6 }),
      );
      mockGetUnreviewed.mockResolvedValue({ items: [], total: 0 });
      mockGetRecent.mockResolvedValue({ items: [], total: 0 });
      mockGetAttention.mockResolvedValue({ items: [], total: 0 });
      mockGetDashboardStale.mockResolvedValue({ items: [], total: 0 });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      renderWithContext(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText(/建立/)).toBeInTheDocument();
      });
      expect(screen.getByText("25")).toBeInTheDocument();
      expect(screen.getByText("18")).toBeInTheDocument();
      expect(screen.getByText("6")).toBeInTheDocument();
    });
  });

  // --- Section 4: Category Distribution ---
  describe("分類分布 section", () => {
    it("shows category distribution bars", async () => {
      mockGetStats.mockResolvedValue(makeStats());
      mockGetUnreviewed.mockResolvedValue({ items: [], total: 0 });
      mockGetRecent.mockResolvedValue({ items: [], total: 0 });
      mockGetAttention.mockResolvedValue({ items: [], total: 0 });
      mockGetDashboardStale.mockResolvedValue({ items: [], total: 0 });
      mockGetCategoryDistribution.mockResolvedValue({
        distribution: [
          makeCategoryDist({ category_name: "程式設計", count: 10, color: "#3b82f6" }),
          makeCategoryDist({
            category_id: "cat-2",
            category_name: "閱讀",
            count: 5,
            color: "#ef4444",
          }),
        ],
      });

      renderWithContext(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText("分類分布")).toBeInTheDocument();
      });
      expect(screen.getByText("程式設計")).toBeInTheDocument();
      expect(screen.getByText("閱讀")).toBeInTheDocument();
    });

    it("hides category distribution when no data", async () => {
      setupDefaultMocks();

      renderWithContext(<Dashboard />);

      await waitFor(() => {
        expect(screen.getByText("Zettelkasten 管道")).toBeInTheDocument();
      });
      expect(screen.queryByText("分類分布")).not.toBeInTheDocument();
    });
  });

  // --- Error handling ---
  describe("error handling", () => {
    it("shows toast on stats error", async () => {
      const { toast } = await import("sonner");
      mockGetStats.mockRejectedValue(new Error("Network error"));
      mockGetUnreviewed.mockResolvedValue({ items: [], total: 0 });
      mockGetRecent.mockResolvedValue({ items: [], total: 0 });
      mockGetAttention.mockResolvedValue({ items: [], total: 0 });
      mockGetDashboardStale.mockResolvedValue({ items: [], total: 0 });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      renderWithContext(<Dashboard />);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("無法載入總覽資料");
      });
    });
  });
});
