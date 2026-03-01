import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemList } from "../item-list";
import { renderWithContext } from "@/test-utils";
import type { Item } from "@/lib/types";

const mockListItems = vi.fn();
const mockBatchAction = vi.fn();

vi.mock("@/lib/api", () => ({
  listItems: (...args: unknown[]) => mockListItems(...args),
  batchAction: (...args: unknown[]) => mockBatchAction(...args),
  updateItem: vi.fn().mockResolvedValue({}),
  deleteItem: vi.fn().mockResolvedValue({}),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
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
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ItemList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading spinner initially", () => {
    mockListItems.mockReturnValue(new Promise(() => {}));
    renderWithContext(<ItemList />, { currentView: "notes" });

    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("shows empty state when no items", async () => {
    mockListItems.mockResolvedValue({ items: [], total: 0 });
    renderWithContext(<ItemList />, { currentView: "notes" });

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
    renderWithContext(<ItemList />, { currentView: "notes" });

    await waitFor(() => {
      expect(screen.getByText("First Note")).toBeInTheDocument();
    });
    expect(screen.getByText("Second Note")).toBeInTheDocument();
  });

  it("shows noteChips in notes view", async () => {
    mockListItems.mockResolvedValue({ items: [makeItem()], total: 1 });
    renderWithContext(<ItemList />, { currentView: "notes" });

    await waitFor(() => {
      expect(screen.getByText("閃念")).toBeInTheDocument();
    });
    expect(screen.getByText("發展中")).toBeInTheDocument();
    expect(screen.getByText("永久筆記")).toBeInTheDocument();
    expect(screen.getByText("已匯出")).toBeInTheDocument();
  });

  it("shows todoChips in todos view", async () => {
    mockListItems.mockResolvedValue({
      items: [makeItem({ type: "todo", status: "active" })],
      total: 1,
    });
    renderWithContext(<ItemList />, { currentView: "todos" });

    await waitFor(() => {
      expect(screen.getByText("進行中")).toBeInTheDocument();
    });
    expect(screen.getByText("已完成")).toBeInTheDocument();
  });

  it("does not show chips in scratch view", async () => {
    mockListItems.mockResolvedValue({
      items: [makeItem({ type: "scratch", status: "draft" })],
      total: 1,
    });
    renderWithContext(<ItemList />, { currentView: "scratch" });

    await waitFor(() => {
      expect(screen.getByText("Test Note")).toBeInTheDocument();
    });
    // No sub-nav chips for scratch
    expect(screen.queryByText("閃念")).not.toBeInTheDocument();
    expect(screen.queryByText("進行中")).not.toBeInTheDocument();
  });

  it("calls listItems with correct sort params", async () => {
    mockListItems.mockResolvedValue({ items: [makeItem()], total: 1 });
    renderWithContext(<ItemList />, { currentView: "notes" });

    await waitFor(() => {
      expect(mockListItems).toHaveBeenCalled();
    });

    // Default sort for notes: created desc
    expect(mockListItems).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: "created",
        order: "desc",
      }),
    );
  });

  it("todo view has due date sort option", async () => {
    mockListItems.mockResolvedValue({
      items: [makeItem({ type: "todo", status: "active" })],
      total: 1,
    });
    renderWithContext(<ItemList />, { currentView: "todos" });

    await waitFor(() => {
      expect(screen.getByText("Test Note")).toBeInTheDocument();
    });

    // Todo defaults to due date sort — verify API was called with due sort
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
    renderWithContext(<ItemList />, { currentView: "notes" });

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
    renderWithContext(<ItemList />, { currentView: "notes" });

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
    renderWithContext(<ItemList noteSubView="fleeting" />, { currentView: "notes" });

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
    renderWithContext(<ItemList noteSubView="fleeting" />, { currentView: "notes" });

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
    renderWithContext(<ItemList />, { currentView: "notes" });

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
    renderWithContext(<ItemList />, { currentView: "notes" });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Network error");
    });
  });

  it("disables selection mode button when offline", async () => {
    mockListItems.mockResolvedValue({ items: [makeItem()], total: 1 });
    renderWithContext(<ItemList />, { currentView: "notes", isOnline: false });

    await waitFor(() => {
      expect(screen.getByText("Test Note")).toBeInTheDocument();
    });

    const selectionBtn = screen.getByTitle("多選模式");
    expect(selectionBtn).toBeDisabled();
  });
});
