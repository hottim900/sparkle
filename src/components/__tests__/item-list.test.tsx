import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemList } from "../item-list";
import { renderWithContext } from "@/test-utils";
import type { Item } from "@/lib/types";

const mockListItems = vi.fn();
const mockBatchAction = vi.fn();
const mockListCategories = vi.fn();

vi.mock("@/lib/api", () => ({
  listItems: (...args: unknown[]) => mockListItems(...args),
  batchAction: (...args: unknown[]) => mockBatchAction(...args),
  listCategories: (...args: unknown[]) => mockListCategories(...args),
  updateItem: vi.fn().mockResolvedValue({}),
  deleteItem: vi.fn().mockResolvedValue({}),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const mockNavigate = vi.fn();
let mockSearchParams: Record<string, unknown> = {};

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: "/notes/fleeting", search: mockSearchParams } }),
  getRouteApi: () => ({
    useNavigate: () => mockNavigate,
  }),
}));

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    type: "note",
    title: "Test Note",
    content: "",
    status: "fleeting",
    priority: null,
    due: null,
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

describe("ItemList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = {};
    mockListCategories.mockResolvedValue({
      categories: [],
    });
  });

  it("shows loading spinner initially", () => {
    mockListItems.mockReturnValue(new Promise(() => {}));
    renderWithContext(<ItemList type="note" status="fleeting" />);

    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("shows empty state when no items", async () => {
    mockListItems.mockResolvedValue({ items: [], total: 0 });
    renderWithContext(<ItemList type="note" status="fleeting" />);

    await waitFor(() => {
      expect(screen.getByText("沒有項目")).toBeInTheDocument();
    });
  });

  it("renders items after loading", async () => {
    mockListItems.mockResolvedValue({
      items: [
        makeItem({ id: "1", title: "First Note" }),
        makeItem({ id: "2", title: "Second Note" }),
      ],
      total: 2,
    });
    renderWithContext(<ItemList type="note" status="fleeting" />);

    await waitFor(() => {
      expect(screen.getByText("First Note")).toBeInTheDocument();
    });
    expect(screen.getByText("Second Note")).toBeInTheDocument();
  });

  it("calls listItems with correct params for note type", async () => {
    mockListItems.mockResolvedValue({ items: [makeItem()], total: 1 });
    renderWithContext(<ItemList type="note" status="fleeting" />);

    await waitFor(() => {
      expect(mockListItems).toHaveBeenCalled();
    });

    expect(mockListItems).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "note",
        status: "fleeting",
        sort: "created",
        order: "desc",
      }),
    );
  });

  it("todo type defaults to due date sort", async () => {
    mockListItems.mockResolvedValue({
      items: [makeItem({ type: "todo", status: "active" })],
      total: 1,
    });
    renderWithContext(<ItemList type="todo" status="active" />);

    await waitFor(() => {
      expect(screen.getByText("Test Note")).toBeInTheDocument();
    });

    expect(mockListItems).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: "due",
        order: "asc",
      }),
    );
  });

  it("enters selection mode when clicking multi-select button", async () => {
    mockListItems.mockResolvedValue({ items: [makeItem()], total: 1 });
    const user = userEvent.setup();
    renderWithContext(<ItemList type="note" status="fleeting" />);

    await waitFor(() => {
      expect(screen.getByText("Test Note")).toBeInTheDocument();
    });

    await user.click(screen.getByTitle("多選模式"));
    expect(screen.getByText("已選 0 項")).toBeInTheDocument();
  });

  it("select all and deselect all", async () => {
    mockListItems.mockResolvedValue({
      items: [makeItem({ id: "1", title: "Note A" }), makeItem({ id: "2", title: "Note B" })],
      total: 2,
    });
    const user = userEvent.setup();
    renderWithContext(<ItemList type="note" status="fleeting" />);

    await waitFor(() => {
      expect(screen.getByText("Note A")).toBeInTheDocument();
    });

    // Enter selection mode
    await user.click(screen.getByTitle("多選模式"));
    expect(screen.getByText("已選 0 項")).toBeInTheDocument();

    // Select all
    await user.click(screen.getByText("全選"));
    expect(screen.getByText("已選 2 項")).toBeInTheDocument();

    // Deselect all (button text changes to 取消全選)
    await user.click(screen.getByText("取消全選"));
    expect(screen.getByText("已選 0 項")).toBeInTheDocument();
  });

  it("batch action calls API and shows toast", async () => {
    const { toast } = await import("sonner");
    mockListItems.mockResolvedValue({
      items: [makeItem({ id: "1", title: "Fleeting Note" })],
      total: 1,
    });
    mockBatchAction.mockResolvedValue({ affected: 1, skipped: 0 });
    const user = userEvent.setup();
    renderWithContext(<ItemList type="note" status="fleeting" />);

    await waitFor(() => {
      expect(screen.getByText("Fleeting Note")).toBeInTheDocument();
    });

    // Enter selection mode
    await user.click(screen.getByTitle("多選模式"));

    // Select all
    await user.click(screen.getByText("全選"));

    // Click 發展 batch action
    await user.click(screen.getByText("發展"));

    await waitFor(() => {
      expect(mockBatchAction).toHaveBeenCalledWith(["1"], "develop");
    });
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("發展"));
  });

  it("destructive batch action shows confirm dialog", async () => {
    mockListItems.mockResolvedValue({
      items: [makeItem({ id: "1" })],
      total: 1,
    });
    mockBatchAction.mockResolvedValue({ affected: 1, skipped: 0 });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderWithContext(<ItemList type="note" status="fleeting" />);

    await waitFor(() => {
      expect(screen.getByText("Test Note")).toBeInTheDocument();
    });

    await user.click(screen.getByTitle("多選模式"));
    await user.click(screen.getByText("全選"));
    await user.click(screen.getByText("刪除"));

    expect(confirmSpy).toHaveBeenCalled();
    // Confirm returned false, so batchAction should NOT be called
    expect(mockBatchAction).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("shows load more button when total > limit", async () => {
    mockListItems.mockResolvedValue({
      items: Array.from({ length: 50 }, (_, i) =>
        makeItem({ id: `item-${i}`, title: `Note ${i}` }),
      ),
      total: 100,
    });
    const user = userEvent.setup();
    renderWithContext(<ItemList type="note" status="fleeting" />);

    await waitFor(() => {
      expect(screen.getByText("載入更多...")).toBeInTheDocument();
    });

    mockListItems.mockClear();
    await user.click(screen.getByText("載入更多..."));

    await waitFor(() => {
      expect(mockListItems).toHaveBeenCalledWith(expect.objectContaining({ offset: 50 }));
    });
  });

  it("shows error toast when API fails", async () => {
    const { toast } = await import("sonner");
    mockListItems.mockRejectedValue(new Error("Network error"));
    renderWithContext(<ItemList type="note" status="fleeting" />);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Network error");
    });
  });

  it("disables selection mode button when offline", async () => {
    mockListItems.mockResolvedValue({ items: [makeItem()], total: 1 });
    renderWithContext(<ItemList type="note" status="fleeting" />, { isOnline: false });

    await waitFor(() => {
      expect(screen.getByText("Test Note")).toBeInTheDocument();
    });

    const selectionBtn = screen.getByTitle("多選模式");
    expect(selectionBtn).toBeDisabled();
  });

  describe("category grouping", () => {
    it("groups items by category when categories exist", async () => {
      mockListCategories.mockResolvedValue({
        categories: [
          { id: "cat-1", name: "工作", sort_order: 0, color: null, created: "", modified: "" },
          { id: "cat-2", name: "個人", sort_order: 1, color: null, created: "", modified: "" },
        ],
      });
      mockListItems.mockResolvedValue({
        items: [
          makeItem({ id: "1", title: "Work Note", category_id: "cat-1", category_name: "工作" }),
          makeItem({
            id: "2",
            title: "Personal Note",
            category_id: "cat-2",
            category_name: "個人",
          }),
        ],
        total: 2,
      });
      renderWithContext(<ItemList type="note" status="fleeting" />);

      await waitFor(() => {
        expect(screen.getByText("Work Note")).toBeInTheDocument();
        expect(screen.getByText("Personal Note")).toBeInTheDocument();
        // Group headers should exist
        const headers = screen.getAllByTestId("category-group-header");
        expect(headers).toHaveLength(2);
        expect(headers[0]!.textContent).toContain("工作");
        expect(headers[1]!.textContent).toContain("個人");
      });
    });

    it("shows 未分類 for uncategorized items alongside categorized ones", async () => {
      mockListCategories.mockResolvedValue({
        categories: [
          { id: "cat-1", name: "工作", sort_order: 0, color: null, created: "", modified: "" },
        ],
      });
      mockListItems.mockResolvedValue({
        items: [
          makeItem({ id: "1", title: "Categorized", category_id: "cat-1", category_name: "工作" }),
          makeItem({ id: "2", title: "Uncategorized", category_id: null, category_name: null }),
        ],
        total: 2,
      });
      renderWithContext(<ItemList type="note" status="fleeting" />);

      await waitFor(() => {
        expect(screen.getByText("Categorized")).toBeInTheDocument();
        expect(screen.getByText("Uncategorized")).toBeInTheDocument();
        const headers = screen.getAllByTestId("category-group-header");
        expect(headers).toHaveLength(2);
        expect(headers[0]!.textContent).toContain("工作");
        expect(headers[1]!.textContent).toContain("未分類");
      });
    });

    it("category sections sorted by sort_order with 未分類 last", async () => {
      mockListCategories.mockResolvedValue({
        categories: [
          { id: "cat-2", name: "個人", sort_order: 1, color: null, created: "", modified: "" },
          { id: "cat-1", name: "工作", sort_order: 0, color: null, created: "", modified: "" },
        ],
      });
      mockListItems.mockResolvedValue({
        items: [
          makeItem({ id: "1", title: "Work", category_id: "cat-1", category_name: "工作" }),
          makeItem({ id: "2", title: "Personal", category_id: "cat-2", category_name: "個人" }),
          makeItem({ id: "3", title: "None", category_id: null, category_name: null }),
        ],
        total: 3,
      });
      renderWithContext(<ItemList type="note" status="fleeting" />);

      await waitFor(() => {
        expect(screen.getByText("Work")).toBeInTheDocument();
        // Get all section headers to verify order
        const headers = screen.getAllByTestId("category-group-header").map((el) => el.textContent);
        expect(headers[0]).toContain("工作");
        expect(headers[1]).toContain("個人");
        expect(headers[2]).toContain("未分類");
      });
    });

    it("shows item count per section", async () => {
      mockListCategories.mockResolvedValue({
        categories: [
          { id: "cat-1", name: "工作", sort_order: 0, color: null, created: "", modified: "" },
        ],
      });
      mockListItems.mockResolvedValue({
        items: [
          makeItem({ id: "1", title: "Note A", category_id: "cat-1", category_name: "工作" }),
          makeItem({ id: "2", title: "Note B", category_id: "cat-1", category_name: "工作" }),
        ],
        total: 2,
      });
      renderWithContext(<ItemList type="note" status="fleeting" />);

      await waitFor(() => {
        expect(screen.getByText("Note A")).toBeInTheDocument();
        // Should show count (2) somewhere in the header
        const header = screen.getByTestId("category-group-header");
        expect(header.textContent).toContain("工作");
        expect(header.textContent).toContain("2");
      });
    });

    it("renders flat list when all items are uncategorized", async () => {
      mockListCategories.mockResolvedValue({ categories: [] });
      mockListItems.mockResolvedValue({
        items: [makeItem({ id: "1", title: "Note A" }), makeItem({ id: "2", title: "Note B" })],
        total: 2,
      });
      renderWithContext(<ItemList type="note" status="fleeting" />);

      await waitFor(() => {
        expect(screen.getByText("Note A")).toBeInTheDocument();
      });
      // No group headers should be present
      expect(screen.queryByTestId("category-group-header")).not.toBeInTheDocument();
      expect(screen.queryByText("未分類")).not.toBeInTheDocument();
    });

    it("collapses section when clicking header", async () => {
      const user = userEvent.setup();
      mockListCategories.mockResolvedValue({
        categories: [
          { id: "cat-1", name: "工作", sort_order: 0, color: null, created: "", modified: "" },
        ],
      });
      mockListItems.mockResolvedValue({
        items: [
          makeItem({ id: "1", title: "Work Note", category_id: "cat-1", category_name: "工作" }),
        ],
        total: 1,
      });
      renderWithContext(<ItemList type="note" status="fleeting" />);

      await waitFor(() => {
        expect(screen.getByText("Work Note")).toBeInTheDocument();
      });

      // Click the header to collapse
      const header = screen.getByTestId("category-group-header");
      await user.click(header);

      // Item should be hidden
      expect(screen.queryByText("Work Note")).not.toBeInTheDocument();

      // Click again to expand
      await user.click(header);
      expect(screen.getByText("Work Note")).toBeInTheDocument();
    });
  });
});
