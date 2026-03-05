import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dashboard } from "../dashboard";
import { renderWithContext } from "@/test-utils";
import type { StatsResponse, StaleItem, CategoryDistribution } from "@/lib/types";

const mockGetStats = vi.fn();
const mockGetFocus = vi.fn();
const mockGetStaleNotes = vi.fn();
const mockGetCategoryDistribution = vi.fn();

vi.mock("@/lib/api", () => ({
  getStats: (...args: unknown[]) => mockGetStats(...args),
  getFocus: (...args: unknown[]) => mockGetFocus(...args),
  getStaleNotes: (...args: unknown[]) => mockGetStaleNotes(...args),
  getCategoryDistribution: (...args: unknown[]) => mockGetCategoryDistribution(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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

function makeFocusItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "focus-1",
    type: "todo",
    title: "Urgent Task",
    content: "",
    status: "active",
    priority: "high",
    due: "2026-03-01",
    tags: "[]",
    source: null,
    origin: "web",
    aliases: "[]",
    linked_note_id: null,
    linked_note_title: null,
    linked_todo_count: 0,
    share_visibility: null,
    category_id: null,
    category_name: null,
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeStaleItem(overrides: Partial<StaleItem> = {}): StaleItem {
  return {
    id: "stale-1",
    title: "Stale Note",
    category_name: null,
    modified: "2026-02-20T00:00:00Z",
    days_stale: 12,
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
  mockGetFocus.mockResolvedValue({ items: [] });
  mockGetStaleNotes.mockResolvedValue({ items: [] });
  mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });
}

describe("Dashboard", () => {
  const onSelectItem = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Loading ---
  it("shows loading spinner initially", () => {
    mockGetStats.mockReturnValue(new Promise(() => {}));
    mockGetFocus.mockReturnValue(new Promise(() => {}));
    mockGetStaleNotes.mockReturnValue(new Promise(() => {}));
    mockGetCategoryDistribution.mockReturnValue(new Promise(() => {}));

    renderWithContext(<Dashboard onSelectItem={onSelectItem} />);
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  // --- Section 1: Needs Attention ---
  describe("需要關注 section", () => {
    it("shows focus items with priority badge", async () => {
      mockGetStats.mockResolvedValue(makeStats());
      mockGetFocus.mockResolvedValue({
        items: [makeFocusItem({ title: "High Priority Task", priority: "high" })],
      });
      mockGetStaleNotes.mockResolvedValue({ items: [] });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

      await waitFor(() => {
        expect(screen.getByText("High Priority Task")).toBeInTheDocument();
      });
      expect(screen.getByText("高")).toBeInTheDocument();
    });

    it("shows focus item due date", async () => {
      mockGetStats.mockResolvedValue(makeStats());
      mockGetFocus.mockResolvedValue({
        items: [makeFocusItem({ title: "Due Task", due: "2026-03-10" })],
      });
      mockGetStaleNotes.mockResolvedValue({ items: [] });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

      await waitFor(() => {
        expect(screen.getByText("Due Task")).toBeInTheDocument();
      });
      // Should show formatted due date
      expect(screen.getByText(/3月10日/)).toBeInTheDocument();
    });

    it("shows stale notes with days badge", async () => {
      mockGetStats.mockResolvedValue(makeStats());
      mockGetFocus.mockResolvedValue({ items: [] });
      mockGetStaleNotes.mockResolvedValue({
        items: [makeStaleItem({ title: "Old Developing Note", days_stale: 14 })],
      });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

      await waitFor(() => {
        expect(screen.getByText("Old Developing Note")).toBeInTheDocument();
      });
      expect(screen.getByText("14 天未更新")).toBeInTheDocument();
    });

    it("shows empty state when no focus items and no stale notes", async () => {
      setupDefaultMocks();

      renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

      await waitFor(() => {
        expect(screen.getByText("沒有需要關注的項目，做得好！")).toBeInTheDocument();
      });
    });

    it("calls onSelectItem when focus item is clicked", async () => {
      mockGetStats.mockResolvedValue(makeStats());
      mockGetFocus.mockResolvedValue({
        items: [makeFocusItem({ title: "Click Me Focus" })],
      });
      mockGetStaleNotes.mockResolvedValue({ items: [] });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      const user = userEvent.setup();
      renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

      await waitFor(() => {
        expect(screen.getByText("Click Me Focus")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Click Me Focus"));
      expect(onSelectItem).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Click Me Focus" }),
      );
    });

    it("calls onNavigate when stale note is clicked", async () => {
      mockGetStats.mockResolvedValue(makeStats());
      mockGetFocus.mockResolvedValue({ items: [] });
      mockGetStaleNotes.mockResolvedValue({
        items: [makeStaleItem({ id: "stale-nav", title: "Navigate To This" })],
      });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      const mockOnNavigate = vi.fn();
      const user = userEvent.setup();
      renderWithContext(<Dashboard onSelectItem={onSelectItem} />, {
        onNavigate: mockOnNavigate,
      });

      await waitFor(() => {
        expect(screen.getByText("Navigate To This")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Navigate To This"));
      expect(mockOnNavigate).toHaveBeenCalledWith("stale-nav");
    });
  });

  // --- Section 2: Pipeline ---
  describe("Zettelkasten 管道 section", () => {
    it("shows pipeline counts", async () => {
      mockGetStats.mockResolvedValue(
        makeStats({ fleeting_count: 7, developing_count: 4, permanent_count: 20 }),
      );
      mockGetFocus.mockResolvedValue({ items: [] });
      mockGetStaleNotes.mockResolvedValue({ items: [] });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

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
      renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

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

    it("calls onViewChange('fleeting') when fleeting card is clicked", async () => {
      setupDefaultMocks();
      const mockOnViewChange = vi.fn();
      const user = userEvent.setup();
      renderWithContext(<Dashboard onSelectItem={onSelectItem} />, {
        onViewChange: mockOnViewChange,
      });

      await waitFor(() => {
        expect(screen.getByTestId("pipeline-fleeting")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("pipeline-fleeting"));
      expect(mockOnViewChange).toHaveBeenCalledWith("fleeting");
    });

    it("calls onViewChange('developing') when developing card is clicked", async () => {
      setupDefaultMocks();
      const mockOnViewChange = vi.fn();
      const user = userEvent.setup();
      renderWithContext(<Dashboard onSelectItem={onSelectItem} />, {
        onViewChange: mockOnViewChange,
      });

      await waitFor(() => {
        expect(screen.getByTestId("pipeline-developing")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("pipeline-developing"));
      expect(mockOnViewChange).toHaveBeenCalledWith("developing");
    });

    it("calls onViewChange('permanent') when permanent card is clicked", async () => {
      setupDefaultMocks();
      const mockOnViewChange = vi.fn();
      const user = userEvent.setup();
      renderWithContext(<Dashboard onSelectItem={onSelectItem} />, {
        onViewChange: mockOnViewChange,
      });

      await waitFor(() => {
        expect(screen.getByTestId("pipeline-permanent")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("pipeline-permanent"));
      expect(mockOnViewChange).toHaveBeenCalledWith("permanent");
    });
  });

  // --- Section 3: Monthly Summary ---
  describe("本月活動 section", () => {
    it("shows monthly summary numbers", async () => {
      mockGetStats.mockResolvedValue(
        makeStats({ created_this_month: 25, done_this_month: 18, exported_this_month: 6 }),
      );
      mockGetFocus.mockResolvedValue({ items: [] });
      mockGetStaleNotes.mockResolvedValue({ items: [] });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

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
      mockGetFocus.mockResolvedValue({ items: [] });
      mockGetStaleNotes.mockResolvedValue({ items: [] });
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

      renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

      await waitFor(() => {
        expect(screen.getByText("分類分布")).toBeInTheDocument();
      });
      expect(screen.getByText("程式設計")).toBeInTheDocument();
      expect(screen.getByText("閱讀")).toBeInTheDocument();
    });

    it("hides category distribution when no data", async () => {
      setupDefaultMocks();

      renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

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
      mockGetFocus.mockResolvedValue({ items: [] });
      mockGetStaleNotes.mockResolvedValue({ items: [] });
      mockGetCategoryDistribution.mockResolvedValue({ distribution: [] });

      renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("無法載入總覽資料");
      });
    });
  });
});
