import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FleetingTriage } from "../fleeting-triage";
import { toast } from "sonner";

const mockListItems = vi.fn();
const mockUpdateItem = vi.fn();
const mockGetTags = vi.fn();

vi.mock("@/lib/api", () => ({
  listItems: (...args: unknown[]) => mockListItems(...args),
  updateItem: (...args: unknown[]) => mockUpdateItem(...args),
  getTags: (...args: unknown[]) => mockGetTags(...args),
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
}

describe("FleetingTriage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
