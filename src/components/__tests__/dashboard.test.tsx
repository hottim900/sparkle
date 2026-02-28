import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dashboard } from "../dashboard";
import { renderWithContext } from "@/test-utils";
import type { StatsResponse } from "@/lib/types";

const mockGetStats = vi.fn();
const mockGetFocus = vi.fn();

vi.mock("@/lib/api", () => ({
  getStats: (...args: unknown[]) => mockGetStats(...args),
  getFocus: (...args: unknown[]) => mockGetFocus(...args),
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
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("Dashboard", () => {
  const onSelectItem = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading spinner initially", () => {
    mockGetStats.mockReturnValue(new Promise(() => {})); // never resolves
    mockGetFocus.mockReturnValue(new Promise(() => {}));

    renderWithContext(<Dashboard onSelectItem={onSelectItem} />);
    // Loader2 has animate-spin class; there should be a spinner visible
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("renders stats after loading", async () => {
    mockGetStats.mockResolvedValue(makeStats({ permanent_count: 42, developing_count: 7 }));
    mockGetFocus.mockResolvedValue({ items: [] });

    renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("shows fleeting health message for zero fleeting", async () => {
    mockGetStats.mockResolvedValue(makeStats({ fleeting_count: 0 }));
    mockGetFocus.mockResolvedValue({ items: [] });

    renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

    await waitFor(() => {
      expect(screen.getByText("閃念筆記已清空！")).toBeInTheDocument();
    });
  });

  it("shows healthy fleeting message for 1-10 fleeting notes", async () => {
    mockGetStats.mockResolvedValue(makeStats({ fleeting_count: 5 }));
    mockGetFocus.mockResolvedValue({ items: [] });

    renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

    await waitFor(() => {
      expect(screen.getByText("閃念筆記狀態良好")).toBeInTheDocument();
    });
  });

  it("shows warning for many fleeting notes with triage button", async () => {
    mockGetStats.mockResolvedValue(makeStats({ fleeting_count: 15 }));
    mockGetFocus.mockResolvedValue({ items: [] });

    renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

    await waitFor(() => {
      expect(screen.getByText("有 15 筆閃念待整理")).toBeInTheDocument();
    });
    expect(screen.getByText("開始整理")).toBeInTheDocument();
  });

  it("renders focus items", async () => {
    mockGetStats.mockResolvedValue(makeStats());
    mockGetFocus.mockResolvedValue({
      items: [makeFocusItem({ title: "My Focus Task" })],
    });

    renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

    await waitFor(() => {
      expect(screen.getByText("My Focus Task")).toBeInTheDocument();
    });
  });

  it("calls onSelectItem when focus item is clicked", async () => {
    mockGetStats.mockResolvedValue(makeStats());
    mockGetFocus.mockResolvedValue({
      items: [makeFocusItem({ title: "Click Me" })],
    });

    const user = userEvent.setup();
    renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

    await waitFor(() => {
      expect(screen.getByText("Click Me")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Click Me"));
    expect(onSelectItem).toHaveBeenCalledWith(expect.objectContaining({ title: "Click Me" }));
  });

  it("shows overdue warning when overdue_count > 0", async () => {
    mockGetStats.mockResolvedValue(makeStats({ overdue_count: 3 }));
    mockGetFocus.mockResolvedValue({ items: [] });

    renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

    await waitFor(() => {
      expect(screen.getByText("3 筆已逾期")).toBeInTheDocument();
    });
  });

  it("shows scratch section when scratch_count > 0", async () => {
    mockGetStats.mockResolvedValue(makeStats({ scratch_count: 5 }));
    mockGetFocus.mockResolvedValue({ items: [] });

    renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

    await waitFor(() => {
      expect(screen.getByText("暫存區")).toBeInTheDocument();
    });
  });

  it("does not show empty focus message when there are items", async () => {
    mockGetStats.mockResolvedValue(makeStats());
    mockGetFocus.mockResolvedValue({
      items: [makeFocusItem()],
    });

    renderWithContext(<Dashboard onSelectItem={onSelectItem} />);

    await waitFor(() => {
      expect(screen.getByText("Urgent Task")).toBeInTheDocument();
    });
    expect(screen.queryByText("沒有緊急項目，做得好！")).not.toBeInTheDocument();
  });
});
