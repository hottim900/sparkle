import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LinkedItemsSection } from "@/components/linked-items-section";
import type { ParsedItem, Item } from "@/lib/types";
import * as api from "@/lib/api";
import { toast } from "sonner";

vi.mock("@/lib/api");

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeNoteItem(overrides: Partial<ParsedItem> = {}): ParsedItem {
  return {
    id: "note-1",
    type: "note",
    title: "Test Note",
    content: "",
    status: "fleeting",
    priority: null,
    due: null,
    tags: [],
    source: null,
    origin: "web",
    aliases: [],
    linked_note_id: null,
    linked_note_title: null,
    linked_todo_count: 0,
    share_visibility: null,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeTodoItem(overrides: Partial<ParsedItem> = {}): ParsedItem {
  return {
    id: "todo-1",
    type: "todo",
    title: "Test Todo",
    content: "",
    status: "active",
    priority: null,
    due: null,
    tags: [],
    source: null,
    origin: "web",
    aliases: [],
    linked_note_id: null,
    linked_note_title: null,
    linked_todo_count: 0,
    share_visibility: null,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRawItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "raw-1",
    type: "todo",
    title: "Raw Item",
    content: "",
    status: "active",
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
    ...overrides,
  };
}

const defaultProps = {
  allTags: [] as string[],
  createTodoRequested: false,
  onCreateTodoDismiss: vi.fn(),
  onNavigate: vi.fn(),
  onUpdated: vi.fn(),
  onItemChange: vi.fn(),
  onSaveStatusChange: vi.fn(),
};

function renderLinked(item: ParsedItem, propOverrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, ...propOverrides };
  return render(<LinkedItemsSection item={item} {...props} />);
}

describe("LinkedItemsSection (note mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays linked todos", async () => {
    const linkedTodos: Item[] = [
      makeRawItem({ id: "t1", title: "Todo A", type: "todo" }),
      makeRawItem({ id: "t2", title: "Todo B", type: "todo" }),
    ];
    vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: linkedTodos, total: 2 });

    renderLinked(makeNoteItem());

    await waitFor(() => {
      expect(screen.getByText("Todo A")).toBeInTheDocument();
    });
    expect(screen.getByText("Todo B")).toBeInTheDocument();
  });

  it("shows create todo form with prefilled title when createTodoRequested", async () => {
    vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });

    renderLinked(makeNoteItem({ title: "My Note" }), {
      createTodoRequested: true,
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("處理：My Note")).toBeInTheDocument();
    });
  });

  it("calls onCreateTodoDismiss when createTodoRequested", async () => {
    vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });
    const onCreateTodoDismiss = vi.fn();

    renderLinked(makeNoteItem(), {
      createTodoRequested: true,
      onCreateTodoDismiss,
    });

    await waitFor(() => {
      expect(onCreateTodoDismiss).toHaveBeenCalled();
    });
  });

  it("creates linked todo on form submit", async () => {
    vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(api.createItem).mockResolvedValue(
      makeRawItem({ id: "new-todo", title: "處理：My Note", type: "todo" }),
    );

    const user = userEvent.setup();
    const onUpdated = vi.fn();

    renderLinked(makeNoteItem({ id: "note-1", title: "My Note" }), {
      createTodoRequested: true,
      onUpdated,
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("處理：My Note")).toBeInTheDocument();
    });

    // Click the "建立" button
    await user.click(screen.getByRole("button", { name: /建立/ }));

    await waitFor(() => {
      expect(api.createItem).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "處理：My Note",
          type: "todo",
          linked_note_id: "note-1",
        }),
      );
    });
  });

  it("shows toast and calls onUpdated after creation", async () => {
    vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(api.createItem).mockResolvedValue(
      makeRawItem({ id: "new-todo", title: "處理：My Note", type: "todo" }),
    );

    const user = userEvent.setup();
    const onUpdated = vi.fn();

    renderLinked(makeNoteItem({ title: "My Note" }), {
      createTodoRequested: true,
      onUpdated,
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("處理：My Note")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /建立/ }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("已建立關聯待辦");
    });
    expect(onUpdated).toHaveBeenCalled();
  });

  it("disables create button when title is empty", async () => {
    vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });

    const user = userEvent.setup();

    renderLinked(makeNoteItem({ title: "My Note" }), {
      createTodoRequested: true,
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("處理：My Note")).toBeInTheDocument();
    });

    // Clear the title
    const titleInput = screen.getByDisplayValue("處理：My Note");
    await user.clear(titleInput);

    expect(screen.getByRole("button", { name: /建立/ })).toBeDisabled();
  });

  it("clicking a linked todo calls onNavigate", async () => {
    const linkedTodos: Item[] = [makeRawItem({ id: "t1", title: "Navigate Todo", type: "todo" })];
    vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: linkedTodos, total: 1 });

    const user = userEvent.setup();
    const onNavigate = vi.fn();

    renderLinked(makeNoteItem(), { onNavigate });

    await waitFor(() => {
      expect(screen.getByText("Navigate Todo")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Navigate Todo"));
    expect(onNavigate).toHaveBeenCalledWith("t1");
  });
});

describe("LinkedItemsSection (todo mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays linked note title", async () => {
    vi.mocked(api.getItem).mockResolvedValue(
      makeRawItem({ id: "linked-note", title: "Linked Note Title", type: "note" }),
    );

    renderLinked(makeTodoItem({ linked_note_id: "linked-note" }));

    await waitFor(() => {
      expect(screen.getByText("Linked Note Title")).toBeInTheDocument();
    });
  });

  it("click linked note calls onNavigate", async () => {
    vi.mocked(api.getItem).mockResolvedValue(
      makeRawItem({ id: "linked-note", title: "Click Me Note", type: "note" }),
    );

    const user = userEvent.setup();
    const onNavigate = vi.fn();

    renderLinked(makeTodoItem({ linked_note_id: "linked-note" }), { onNavigate });

    await waitFor(() => {
      expect(screen.getByText("Click Me Note")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Click Me Note"));
    expect(onNavigate).toHaveBeenCalledWith("linked-note");
  });

  it("shows search UI when clicking search button", async () => {
    const user = userEvent.setup();

    renderLinked(makeTodoItem());

    await waitFor(() => {
      expect(screen.getByText("搜尋並關聯筆記")).toBeInTheDocument();
    });

    await user.click(screen.getByText("搜尋並關聯筆記"));

    expect(screen.getByPlaceholderText("搜尋筆記...")).toBeInTheDocument();
  });

  it("search triggers debounced API call", async () => {
    vi.useFakeTimers();

    vi.mocked(api.searchItemsApi).mockResolvedValue({
      results: [makeRawItem({ id: "r1", title: "Result Note", type: "note" })],
    });

    renderLinked(makeTodoItem());

    await act(async () => {});

    // Open search
    const searchBtn = screen.getByText("搜尋並關聯筆記");
    await act(async () => {
      fireEvent.click(searchBtn);
    });

    const searchInput = screen.getByPlaceholderText("搜尋筆記...");
    fireEvent.change(searchInput, { target: { value: "test query" } });

    // Not called immediately
    expect(api.searchItemsApi).not.toHaveBeenCalled();

    // Advance past 300ms debounce
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(api.searchItemsApi).toHaveBeenCalledWith("test query", 10);

    vi.useRealTimers();
  });

  it("clicking search result links the note", async () => {
    vi.useFakeTimers();

    const searchResult = makeRawItem({ id: "found-note", title: "Found Note", type: "note" });
    vi.mocked(api.searchItemsApi).mockResolvedValue({ results: [searchResult] });
    vi.mocked(api.updateItem).mockResolvedValue(
      makeRawItem({ id: "todo-1", type: "todo", linked_note_id: "found-note" }),
    );
    vi.mocked(api.getItem).mockResolvedValue(searchResult);

    renderLinked(makeTodoItem());

    await act(async () => {});

    // Open search and type
    await act(async () => {
      fireEvent.click(screen.getByText("搜尋並關聯筆記"));
    });

    const searchInput = screen.getByPlaceholderText("搜尋筆記...");
    fireEvent.change(searchInput, { target: { value: "found" } });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Wait for results to render
    await act(async () => {});

    // Click the result
    await act(async () => {
      fireEvent.click(screen.getByText("Found Note"));
    });

    expect(api.updateItem).toHaveBeenCalledWith("todo-1", { linked_note_id: "found-note" });

    vi.useRealTimers();
  });

  it("unlink calls updateItem with null linked_note_id", async () => {
    vi.mocked(api.getItem).mockResolvedValue(
      makeRawItem({ id: "linked-note", title: "Linked Note", type: "note" }),
    );
    vi.mocked(api.updateItem).mockResolvedValue(
      makeRawItem({ id: "todo-1", type: "todo", linked_note_id: null }),
    );

    const user = userEvent.setup();
    const onItemChange = vi.fn();

    renderLinked(makeTodoItem({ linked_note_id: "linked-note" }), { onItemChange });

    await waitFor(() => {
      expect(screen.getByText("Linked Note")).toBeInTheDocument();
    });

    await user.click(screen.getByText("解除關聯"));

    await waitFor(() => {
      expect(api.updateItem).toHaveBeenCalledWith("todo-1", { linked_note_id: null });
    });
  });

  it("shows no results message when search returns empty", async () => {
    vi.useFakeTimers();

    vi.mocked(api.searchItemsApi).mockResolvedValue({ results: [] });

    renderLinked(makeTodoItem());

    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByText("搜尋並關聯筆記"));
    });

    const searchInput = screen.getByPlaceholderText("搜尋筆記...");
    fireEvent.change(searchInput, { target: { value: "nothing" } });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Wait for search to complete
    await act(async () => {});

    expect(screen.getByText("找不到筆記")).toBeInTheDocument();

    vi.useRealTimers();
  });
});
