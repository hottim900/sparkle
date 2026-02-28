import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBar } from "../search-bar";

const mockSearchItemsApi = vi.fn();

vi.mock("@/lib/api", () => ({
  searchItemsApi: (...args: unknown[]) => mockSearchItemsApi(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeSearchResult(overrides: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    type: "note",
    title: "Found Note",
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
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("SearchBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders search input", () => {
    render(<SearchBar />);
    expect(screen.getByPlaceholderText("搜尋...")).toBeInTheDocument();
  });

  it("triggers search after debounce delay", async () => {
    mockSearchItemsApi.mockResolvedValue({
      results: [makeSearchResult()],
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchBar />);

    const input = screen.getByPlaceholderText("搜尋...");
    await user.type(input, "test");

    // Advance past debounce (300ms)
    vi.advanceTimersByTime(350);

    await waitFor(() => {
      expect(mockSearchItemsApi).toHaveBeenCalledWith("test");
    });
  });

  it("triggers immediate search on Enter", async () => {
    mockSearchItemsApi.mockResolvedValue({
      results: [makeSearchResult()],
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchBar />);

    const input = screen.getByPlaceholderText("搜尋...");
    await user.type(input, "query{Enter}");

    await waitFor(() => {
      expect(mockSearchItemsApi).toHaveBeenCalledWith("query");
    });
  });

  it("displays search results", async () => {
    mockSearchItemsApi.mockResolvedValue({
      results: [makeSearchResult({ title: "My Search Result" })],
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchBar />);

    const input = screen.getByPlaceholderText("搜尋...");
    await user.type(input, "xyz{Enter}");

    await waitFor(() => {
      expect(screen.getByText("My Search Result")).toBeInTheDocument();
    });

    expect(screen.getByText("找到 1 個結果")).toBeInTheDocument();
  });

  it("shows no results message", async () => {
    mockSearchItemsApi.mockResolvedValue({ results: [] });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchBar />);

    const input = screen.getByPlaceholderText("搜尋...");
    await user.type(input, "nothing{Enter}");

    await waitFor(() => {
      expect(screen.getByText("找不到結果")).toBeInTheDocument();
    });
  });

  it("calls onSelect when clicking a result", async () => {
    mockSearchItemsApi.mockResolvedValue({
      results: [makeSearchResult({ title: "Clickable Result" })],
    });

    const onSelect = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SearchBar onSelect={onSelect} />);

    const input = screen.getByPlaceholderText("搜尋...");
    await user.type(input, "xyz{Enter}");

    await waitFor(() => {
      expect(screen.getByText("Clickable Result")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Clickable Result"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ title: "Clickable Result" }));
  });
});
