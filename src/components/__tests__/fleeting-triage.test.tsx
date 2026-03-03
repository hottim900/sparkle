import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FleetingTriage } from "../fleeting-triage";
import { toast } from "sonner";

const mockListItems = vi.fn();
const mockUpdateItem = vi.fn();
const mockGetTags = vi.fn();
const mockListCategories = vi.fn();
const mockCreateCategory = vi.fn();

vi.mock("@/lib/api", () => ({
  listItems: (...args: unknown[]) => mockListItems(...args),
  updateItem: (...args: unknown[]) => mockUpdateItem(...args),
  getTags: (...args: unknown[]) => mockGetTags(...args),
  listCategories: (...args: unknown[]) => mockListCategories(...args),
  createCategory: (...args: unknown[]) => mockCreateCategory(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeFleetingItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    type: "note",
    title: "Test Fleeting Note",
    content: "Some content here",
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
    category_id: null,
    category_name: null,
    share_visibility: null,
    created: "2026-02-28T10:00:00Z",
    modified: "2026-02-28T10:00:00Z",
    ...overrides,
  };
}

function setupWithItems(items: Record<string, unknown>[]) {
  mockListItems.mockResolvedValue({ items, total: items.length });
  mockGetTags.mockResolvedValue({ tags: ["existing-tag"] });
  mockUpdateItem.mockResolvedValue({});
  mockListCategories.mockResolvedValue({
    categories: [
      { id: "cat-1", name: "工作", color: "#ef4444", sort_order: 0 },
      { id: "cat-2", name: "學習", color: "#3b82f6", sort_order: 1 },
    ],
  });
}

describe("FleetingTriage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Radix Select polyfills for jsdom
    window.HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));
  });

  it("shows loading spinner initially", () => {
    mockListItems.mockReturnValue(new Promise(() => {}));
    mockGetTags.mockReturnValue(new Promise(() => {}));

    render(<FleetingTriage />);
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows completion message when no fleeting items", async () => {
    setupWithItems([]);

    render(<FleetingTriage />);

    await waitFor(() => {
      expect(screen.getByText("閃念筆記已處理完畢")).toBeInTheDocument();
    });
    expect(screen.getByText("返回")).toBeInTheDocument();
  });

  it("calls onDone when return button is clicked", async () => {
    setupWithItems([]);
    const onDone = vi.fn();

    const user = userEvent.setup();
    render(<FleetingTriage onDone={onDone} />);

    await waitFor(() => {
      expect(screen.getByText("返回")).toBeInTheDocument();
    });

    await user.click(screen.getByText("返回"));
    expect(onDone).toHaveBeenCalled();
  });

  it("displays card with title, content, and origin", async () => {
    setupWithItems([
      makeFleetingItem({
        title: "My Idea",
        content: "Details about the idea",
        origin: "LINE",
      }),
    ]);

    render(<FleetingTriage />);

    await waitFor(() => {
      expect(screen.getByText("My Idea")).toBeInTheDocument();
    });
    expect(screen.getByText("Details about the idea")).toBeInTheDocument();
    expect(screen.getByText("來源: LINE")).toBeInTheDocument();
  });

  it("shows remaining count", async () => {
    setupWithItems([
      makeFleetingItem({ id: "item-1", title: "First" }),
      makeFleetingItem({ id: "item-2", title: "Second" }),
    ]);

    render(<FleetingTriage />);

    await waitFor(() => {
      expect(screen.getByText("剩餘 2 項")).toBeInTheDocument();
    });
  });

  it("toggles type to todo and changes primary button text", async () => {
    setupWithItems([makeFleetingItem()]);

    const user = userEvent.setup();
    render(<FleetingTriage />);

    await waitFor(() => {
      expect(screen.getByText("發展")).toBeInTheDocument();
    });

    await user.click(screen.getByText("待辦"));
    expect(screen.getByText("進行")).toBeInTheDocument();
  });

  it("primary action sends status=developing for note type", async () => {
    setupWithItems([makeFleetingItem({ id: "note-1" })]);

    const user = userEvent.setup();
    render(<FleetingTriage />);

    await waitFor(() => {
      expect(screen.getByText("發展")).toBeInTheDocument();
    });

    await user.click(screen.getByText("發展"));

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith("note-1", { status: "developing" });
    });
    expect(toast.success).toHaveBeenCalledWith("已設為發展中");
  });

  it("primary action sends status=active and type=todo after toggle", async () => {
    setupWithItems([makeFleetingItem({ id: "note-2" })]);

    const user = userEvent.setup();
    render(<FleetingTriage />);

    await waitFor(() => {
      expect(screen.getByText("發展")).toBeInTheDocument();
    });

    await user.click(screen.getByText("待辦"));
    await user.click(screen.getByText("進行"));

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith("note-2", {
        status: "active",
        type: "todo",
      });
    });
    expect(toast.success).toHaveBeenCalledWith("已設為進行中");
  });

  it("archive action sends status=archived", async () => {
    setupWithItems([makeFleetingItem({ id: "arch-1" })]);

    const user = userEvent.setup();
    render(<FleetingTriage />);

    await waitFor(() => {
      expect(screen.getByText("封存")).toBeInTheDocument();
    });

    await user.click(screen.getByText("封存"));

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith("arch-1", { status: "archived" });
    });
    expect(toast.success).toHaveBeenCalledWith("已封存");
  });

  it("skip moves to next item without API call", async () => {
    setupWithItems([
      makeFleetingItem({ id: "item-1", title: "First Note" }),
      makeFleetingItem({ id: "item-2", title: "Second Note" }),
    ]);

    const user = userEvent.setup();
    render(<FleetingTriage />);

    await waitFor(() => {
      expect(screen.getByText("First Note")).toBeInTheDocument();
    });

    await user.click(screen.getByText("保留"));

    expect(mockUpdateItem).not.toHaveBeenCalled();
    expect(screen.getByText("Second Note")).toBeInTheDocument();
    expect(screen.getByText("剩餘 1 項")).toBeInTheDocument();
  });

  it("calls onDone after completing last item", async () => {
    setupWithItems([makeFleetingItem({ id: "only-1" })]);
    const onDone = vi.fn();

    const user = userEvent.setup();
    render(<FleetingTriage onDone={onDone} />);

    await waitFor(() => {
      expect(screen.getByText("發展")).toBeInTheDocument();
    });

    await user.click(screen.getByText("發展"));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("閃念筆記已處理完畢！");
    });
    expect(onDone).toHaveBeenCalled();
  });

  it("shows toast.error on API failure", async () => {
    setupWithItems([makeFleetingItem()]);
    mockUpdateItem.mockRejectedValue(new Error("Network error"));

    const user = userEvent.setup();
    render(<FleetingTriage />);

    await waitFor(() => {
      expect(screen.getByText("發展")).toBeInTheDocument();
    });

    await user.click(screen.getByText("發展"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Network error");
    });
  });

  describe("category selection", () => {
    // Helper: CategorySelect trigger is the combobox that is a <button>, not the TagInput <input>
    function getCategoryCombobox() {
      const comboboxes = screen.getAllByRole("combobox");
      const selectTrigger = comboboxes.find((el) => el.tagName === "BUTTON");
      if (!selectTrigger) throw new Error("CategorySelect combobox not found");
      return selectTrigger;
    }

    it("includes category_id in primary action when category is selected", async () => {
      setupWithItems([makeFleetingItem({ id: "cat-note-1" })]);

      const user = userEvent.setup();
      render(<FleetingTriage />);

      await waitFor(() => {
        expect(screen.getByText("Test Fleeting Note")).toBeInTheDocument();
      });

      // Open category select and pick "工作"
      await user.click(getCategoryCombobox());
      const option = await screen.findByRole("option", { name: /工作/ });
      await user.click(option);

      await user.click(screen.getByText("發展"));

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith("cat-note-1", {
          status: "developing",
          category_id: "cat-1",
        });
      });
    });

    it("includes category_id in archive action when category is selected", async () => {
      setupWithItems([makeFleetingItem({ id: "cat-arch-1" })]);

      const user = userEvent.setup();
      render(<FleetingTriage />);

      await waitFor(() => {
        expect(screen.getByText("Test Fleeting Note")).toBeInTheDocument();
      });

      await user.click(getCategoryCombobox());
      const option = await screen.findByRole("option", { name: /學習/ });
      await user.click(option);

      await user.click(screen.getByText("封存"));

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith("cat-arch-1", {
          status: "archived",
          category_id: "cat-2",
        });
      });
    });

    it("does not include category_id when no category change is made", async () => {
      setupWithItems([makeFleetingItem({ id: "no-cat-1" })]);

      const user = userEvent.setup();
      render(<FleetingTriage />);

      await waitFor(() => {
        expect(screen.getByText("發展")).toBeInTheDocument();
      });

      await user.click(screen.getByText("發展"));

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith("no-cat-1", { status: "developing" });
      });
    });

    it("resets category selection when skipping to next item", async () => {
      setupWithItems([
        makeFleetingItem({ id: "item-1", title: "First" }),
        makeFleetingItem({ id: "item-2", title: "Second" }),
      ]);

      const user = userEvent.setup();
      render(<FleetingTriage />);

      await waitFor(() => {
        expect(screen.getByText("First")).toBeInTheDocument();
      });

      // Select a category on first item
      await user.click(getCategoryCombobox());
      const option = await screen.findByRole("option", { name: /工作/ });
      await user.click(option);

      // Skip to next
      await user.click(screen.getByText("保留"));

      expect(screen.getByText("Second")).toBeInTheDocument();

      // Category select should show "未分類" (reset to next item's default)
      expect(getCategoryCombobox()).toHaveTextContent("未分類");
    });
  });

  describe("offline behavior", () => {
    let originalOnLine: boolean;

    beforeEach(() => {
      originalOnLine = navigator.onLine;
      Object.defineProperty(navigator, "onLine", {
        value: false,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(navigator, "onLine", {
        value: originalOnLine,
        writable: true,
        configurable: true,
      });
    });

    it("disables primary action button when offline", async () => {
      setupWithItems([makeFleetingItem()]);
      render(<FleetingTriage />);

      await waitFor(() => {
        expect(screen.getByText("發展")).toBeInTheDocument();
      });

      expect(screen.getByRole("button", { name: /發展/ })).toBeDisabled();
    });

    it("disables archive button when offline", async () => {
      setupWithItems([makeFleetingItem()]);
      render(<FleetingTriage />);

      await waitFor(() => {
        expect(screen.getByText("封存")).toBeInTheDocument();
      });

      expect(screen.getByRole("button", { name: /封存/ })).toBeDisabled();
    });

    it("keeps skip button enabled when offline", async () => {
      setupWithItems([makeFleetingItem()]);
      render(<FleetingTriage />);

      await waitFor(() => {
        expect(screen.getByText("保留")).toBeInTheDocument();
      });

      expect(screen.getByRole("button", { name: /保留/ })).not.toBeDisabled();
    });
  });
});
