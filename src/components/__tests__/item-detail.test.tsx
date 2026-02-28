import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AppContext, type AppContextValue } from "@/lib/app-context";
import { ItemDetail } from "@/components/item-detail";
import type { Item } from "@/lib/types";
import * as api from "@/lib/api";

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
  refreshKey: 0,
  refresh: vi.fn(),
};

function renderItemDetail(contextOverrides: Partial<AppContextValue> = {}) {
  const contextValue = { ...defaultContext, ...contextOverrides };
  return render(
    <AppContext.Provider value={contextValue}>
      <ItemDetail itemId="test-1" />
    </AppContext.Provider>,
  );
}

describe("ItemDetail auto-save", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(api.getItem).mockResolvedValue(mockItem);
    vi.mocked(api.getTags).mockResolvedValue({ tags: [] });
    vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });
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

    // Step 2: Debounce fires after 500ms — saveField("title", "New Ti") starts
    act(() => {
      vi.advanceTimersByTime(500);
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
