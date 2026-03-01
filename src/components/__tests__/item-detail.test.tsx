import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppContext, type AppContextValue } from "@/lib/app-context";
import { ItemDetail } from "@/components/item-detail";
import type { Item } from "@/lib/types";
import * as api from "@/lib/api";
import { toast } from "sonner";

vi.mock("@/lib/api");

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockItem: Item = {
  id: "test-1",
  type: "note",
  title: "Original Title",
  content: "Original content",
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
  created: "2026-01-01T00:00:00.000Z",
  modified: "2026-01-01T00:00:00.000Z",
};

const mockTodoItem: Item = {
  ...mockItem,
  type: "todo",
  status: "active",
};

const mockScratchItem: Item = {
  ...mockItem,
  type: "scratch",
  status: "draft",
};

const mockPermanentNote: Item = {
  ...mockItem,
  status: "permanent",
};

const mockItemWithAliases: Item = {
  ...mockItem,
  aliases: '["alias-one","alias-two"]',
};

const defaultContext: AppContextValue = {
  currentView: "notes",
  onViewChange: vi.fn(),
  selectedItem: null,
  onSelectItem: vi.fn(),
  selectedTag: undefined,
  onTagSelect: vi.fn(),
  onNavigate: vi.fn(),
  onBack: vi.fn(),
  onClearDetail: vi.fn(),
  canGoBack: false,
  obsidianEnabled: false,
  isOnline: true,
  refreshKey: 0,
  refresh: vi.fn(),
};

function renderItemDetail(
  contextOverrides: Partial<AppContextValue> = {},
  props: { onDeleted?: () => void; onUpdated?: () => void } = {},
) {
  const contextValue = { ...defaultContext, ...contextOverrides };
  return render(
    <AppContext.Provider value={contextValue}>
      <ItemDetail itemId="test-1" {...props} />
    </AppContext.Provider>,
  );
}

function setupDefaultMocks(item: Item = mockItem) {
  vi.mocked(api.getItem).mockResolvedValue(item);
  vi.mocked(api.getTags).mockResolvedValue({ tags: [] });
  vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });
}

describe("ItemDetail auto-save", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should not overwrite title with server response during typing", async () => {
    // Control when updateItem resolves to simulate network delay
    let resolveUpdate!: (value: Item) => void;
    vi.mocked(api.updateItem).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    renderItemDetail();

    // Flush microtasks for initial load (getItem + getTags + getLinkedTodos)
    await act(async () => {});

    const titleInput = screen.getByPlaceholderText("標題");
    expect(titleInput).toHaveValue("Original Title");

    // Step 1: User types "New Ti" (simulated as a single change event)
    fireEvent.change(titleInput, { target: { value: "New Ti" } });
    expect(titleInput).toHaveValue("New Ti");

    // Step 2: Debounce fires after 1500ms — saveField("title", "New Ti") starts
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(api.updateItem).toHaveBeenCalledWith("test-1", { title: "New Ti" });

    // Step 3: While save is in flight, user continues typing to "New Title"
    fireEvent.change(titleInput, { target: { value: "New Title" } });

    // Step 4: Server responds with stale value "New Ti"
    await act(async () => {
      resolveUpdate({ ...mockItem, title: "New Ti", modified: "2026-01-01T00:01:00.000Z" });
    });

    // Title input should show "New Title" (user's latest), NOT "New Ti" (server's stale response)
    expect(titleInput).toHaveValue("New Title");
  });
});

describe("ItemDetail loading and error states", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state while fetching", () => {
    vi.mocked(api.getItem).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.getTags).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });

    renderItemDetail();
    expect(screen.getByText("載入中...")).toBeInTheDocument();
  });

  it("shows error toast on API failure", async () => {
    vi.mocked(api.getItem).mockRejectedValue(new Error("Network error"));
    vi.mocked(api.getTags).mockResolvedValue({ tags: [] });
    vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });

    renderItemDetail();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Network error");
    });
  });

  it("shows not found message when item fails to load", async () => {
    vi.mocked(api.getItem).mockRejectedValue(new Error("Not found"));
    vi.mocked(api.getTags).mockResolvedValue({ tags: [] });
    vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });

    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("找不到項目")).toBeInTheDocument();
    });
  });
});

describe("ItemDetail title editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setupDefaultMocks();
    vi.mocked(api.updateItem).mockResolvedValue({
      ...mockItem,
      modified: "2026-01-01T00:01:00.000Z",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounced save triggers after 1500ms", async () => {
    renderItemDetail();
    await act(async () => {});

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "Updated Title" } });

    // Not called yet before debounce
    expect(api.updateItem).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(api.updateItem).toHaveBeenCalledWith("test-1", { title: "Updated Title" });
  });

  it("blur triggers immediate save when debounce is pending", async () => {
    renderItemDetail();
    await act(async () => {});

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "Blur Save" } });

    // Debounce not yet fired
    expect(api.updateItem).not.toHaveBeenCalled();

    // Blur should cancel debounce and immediately save
    await act(async () => {
      fireEvent.blur(titleInput);
    });

    expect(api.updateItem).toHaveBeenCalledWith("test-1", { title: "Blur Save" });
  });
});

describe("ItemDetail source URL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setupDefaultMocks();
    vi.mocked(api.updateItem).mockResolvedValue({
      ...mockItem,
      modified: "2026-01-01T00:01:00.000Z",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounced save on source URL change", async () => {
    renderItemDetail();
    await act(async () => {});

    const sourceInput = screen.getByPlaceholderText("https://...");
    fireEvent.change(sourceInput, { target: { value: "https://example.com" } });

    expect(api.updateItem).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(api.updateItem).toHaveBeenCalledWith("test-1", { source: "https://example.com" });
  });
});

describe("ItemDetail alias management", () => {
  beforeEach(() => {
    setupDefaultMocks(mockItemWithAliases);
    vi.mocked(api.updateItem).mockResolvedValue({
      ...mockItemWithAliases,
      modified: "2026-01-01T00:01:00.000Z",
    });
  });

  it("adds alias on Enter key", async () => {
    const user = userEvent.setup();
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("alias-one")).toBeInTheDocument();
    });

    const aliasInput = screen.getByPlaceholderText("新增別名...");
    await user.type(aliasInput, "new-alias{Enter}");

    await waitFor(() => {
      expect(api.updateItem).toHaveBeenCalledWith("test-1", {
        aliases: ["alias-one", "alias-two", "new-alias"],
      });
    });
  });

  it("removes alias on X click", async () => {
    const user = userEvent.setup();
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("alias-one")).toBeInTheDocument();
    });

    // Find the X button within the alias-one badge
    const aliasBadge = screen.getByText("alias-one").closest(".gap-1")!;
    const removeBtn = aliasBadge.querySelector("button")!;
    await user.click(removeBtn);

    await waitFor(() => {
      expect(api.updateItem).toHaveBeenCalledWith("test-1", {
        aliases: ["alias-two"],
      });
    });
  });
});

describe("ItemDetail type-specific rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows due date field only for todo", async () => {
    setupDefaultMocks(mockTodoItem);
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("到期日")).toBeInTheDocument();
    });
  });

  it("does not show due date field for note", async () => {
    setupDefaultMocks();
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("標題")).toBeInTheDocument();
    });
    expect(screen.queryByText("到期日")).not.toBeInTheDocument();
  });

  it("shows GTD quick tags for todo", async () => {
    setupDefaultMocks(mockTodoItem);
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("下一步")).toBeInTheDocument();
    });
    expect(screen.getByText("等待中")).toBeInTheDocument();
    expect(screen.getByText("有一天")).toBeInTheDocument();
  });

  it("does not show GTD quick tags for note", async () => {
    setupDefaultMocks();
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("標題")).toBeInTheDocument();
    });
    expect(screen.queryByText("下一步")).not.toBeInTheDocument();
    expect(screen.queryByText("等待中")).not.toBeInTheDocument();
  });

  it("hides tags and aliases sections for scratch", async () => {
    setupDefaultMocks(mockScratchItem);
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("標題")).toBeInTheDocument();
    });
    // "標籤" label should not exist for scratch
    expect(screen.queryByText("標籤")).not.toBeInTheDocument();
    // "別名" label should not exist for scratch
    expect(screen.queryByText("別名")).not.toBeInTheDocument();
  });

  it("shows share button only for note type", async () => {
    setupDefaultMocks();
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("分享")).toBeInTheDocument();
    });
  });

  it("does not show share button for todo type", async () => {
    setupDefaultMocks(mockTodoItem);
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("標題")).toBeInTheDocument();
    });
    expect(screen.queryByText("分享")).not.toBeInTheDocument();
  });
});

describe("ItemDetail delete", () => {
  beforeEach(() => {
    setupDefaultMocks();
    vi.mocked(api.deleteItem).mockResolvedValue(undefined);
  });

  it("delete flow calls onDeleted callback", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    renderItemDetail({}, { onDeleted });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("標題")).toBeInTheDocument();
    });

    // Find the button containing the trash icon (destructive text)
    const allButtons = screen.getAllByRole("button");
    const deleteButton = allButtons.find((btn) => btn.querySelector(".text-destructive") !== null)!;
    await user.click(deleteButton);

    // Confirm in dialog
    await waitFor(() => {
      expect(screen.getByText("確認刪除")).toBeInTheDocument();
    });

    const confirmBtn = screen.getByRole("button", { name: "刪除" });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(api.deleteItem).toHaveBeenCalledWith("test-1");
    });
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
  });
});

describe("ItemDetail export", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows export button for permanent note with obsidian enabled", async () => {
    setupDefaultMocks(mockPermanentNote);
    renderItemDetail({ obsidianEnabled: true });

    await waitFor(() => {
      expect(screen.getByText("匯出到 Obsidian")).toBeInTheDocument();
    });
  });

  it("hides export button when note is not permanent", async () => {
    setupDefaultMocks(); // fleeting note
    renderItemDetail({ obsidianEnabled: true });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("標題")).toBeInTheDocument();
    });
    expect(screen.queryByText("匯出到 Obsidian")).not.toBeInTheDocument();
  });

  it("hides export button when obsidian is disabled", async () => {
    setupDefaultMocks(mockPermanentNote);
    renderItemDetail({ obsidianEnabled: false });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("標題")).toBeInTheDocument();
    });
    expect(screen.queryByText("匯出到 Obsidian")).not.toBeInTheDocument();
  });

  it("calls exportItem and updates status on success", async () => {
    const user = userEvent.setup();
    const onUpdated = vi.fn();
    setupDefaultMocks(mockPermanentNote);
    vi.mocked(api.exportItem).mockResolvedValue({ path: "/vault/test.md" });
    vi.mocked(api.getItem)
      .mockResolvedValueOnce(mockPermanentNote)
      .mockResolvedValueOnce({
        ...mockPermanentNote,
        status: "exported",
      });

    renderItemDetail({ obsidianEnabled: true }, { onUpdated });

    await waitFor(() => {
      expect(screen.getByText("匯出到 Obsidian")).toBeInTheDocument();
    });

    await user.click(screen.getByText("匯出到 Obsidian"));

    await waitFor(() => {
      expect(api.exportItem).toHaveBeenCalledWith("test-1");
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("已匯出到 Obsidian: /vault/test.md");
    });
    expect(onUpdated).toHaveBeenCalled();
  });
});

describe("ItemDetail offline behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("suppresses auto-save and shows toast when offline", async () => {
    renderItemDetail({ isOnline: false });
    await act(async () => {});

    // Clear any calls from initial load
    vi.mocked(api.updateItem).mockClear();
    vi.mocked(toast.error).mockClear();

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "New Title" } });

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    // Flush microtasks for the async saveField
    await act(async () => {});

    expect(api.updateItem).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("離線中，無法儲存變更");
  });

  it("disables delete button when offline", async () => {
    renderItemDetail({ isOnline: false });
    await act(async () => {});

    // Find the delete button (has Trash2 icon with text-destructive class)
    const buttons = screen.getAllByRole("button");
    const deleteBtn = buttons.find(
      (btn) => btn.querySelector("svg.text-destructive") || btn.querySelector(".text-destructive"),
    );
    expect(deleteBtn).toBeDisabled();
  });

  it("disables header action buttons when offline", async () => {
    renderItemDetail({ isOnline: false });
    await act(async () => {});

    // Share button should be disabled
    const shareBtn = screen.getByRole("button", { name: /分享/ });
    expect(shareBtn).toBeDisabled();

    // Create todo button should be disabled
    const todoBtn = screen.getByRole("button", { name: /建立追蹤待辦/ });
    expect(todoBtn).toBeDisabled();
  });

  it("disables export button when offline", async () => {
    setupDefaultMocks(mockPermanentNote);
    renderItemDetail({ isOnline: false, obsidianEnabled: true });
    await act(async () => {});

    const exportBtn = screen.getByRole("button", { name: /匯出到 Obsidian/ });
    expect(exportBtn).toBeDisabled();
  });

  it("shows offline warning in content editor", async () => {
    renderItemDetail({ isOnline: false });
    await act(async () => {});

    expect(screen.getByText("離線中 — 編輯內容將不會自動儲存")).toBeInTheDocument();
  });
});
