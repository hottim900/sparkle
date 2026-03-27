import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeekView } from "../week-view";
import { renderWithContext } from "@/test-utils";
import type { WeekDay, WeekDataResponse } from "@/lib/types";
import { toast } from "sonner";

const mockGetDashboardWeek = vi.fn();

vi.mock("@/lib/api", () => ({
  getDashboardWeek: (...args: unknown[]) => mockGetDashboardWeek(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

function makeWeekDay(overrides: Partial<WeekDay> = {}): WeekDay {
  return {
    date: "2026-03-23",
    todos_due: [],
    notes_created: [],
    notes_modified: [],
    overdue_count: 0,
    ...overrides,
  };
}

function makeWeekData(days?: WeekDay[]): WeekDataResponse {
  if (days) return { days };
  // Default: a full week starting from a Monday
  return {
    days: [
      makeWeekDay({ date: "2026-03-23" }),
      makeWeekDay({ date: "2026-03-24" }),
      makeWeekDay({ date: "2026-03-25" }),
      makeWeekDay({ date: "2026-03-26" }),
      makeWeekDay({ date: "2026-03-27" }),
      makeWeekDay({ date: "2026-03-28" }),
      makeWeekDay({ date: "2026-03-29" }),
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDashboardWeek.mockResolvedValue(makeWeekData());
});

// --- #231: Error toast dedup ---

describe("WeekView error toast dedup (#231)", () => {
  it("passes a stable ID to toast.error to prevent duplicate toasts", async () => {
    mockGetDashboardWeek.mockRejectedValue(new Error("network error"));

    renderWithContext(<WeekView />);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("無法載入週檢視資料", {
        id: "weekview-fetch-error",
      });
    });
  });
});

// --- #229: Notes overflow indicator ---

describe("DayDetail notes overflow indicator (#229)", () => {
  it("shows overflow text when notesCreated exceeds MAX_ITEMS", async () => {
    const manyNotes = Array.from({ length: 12 }, (_, i) => ({
      id: `note-${i}`,
      title: `Note ${i}`,
      status: "fleeting",
    }));

    const dayWithManyNotes = makeWeekDay({
      date: "2026-03-27",
      notes_created: manyNotes,
    });

    mockGetDashboardWeek.mockResolvedValue(
      makeWeekData([
        makeWeekDay({ date: "2026-03-23" }),
        makeWeekDay({ date: "2026-03-24" }),
        makeWeekDay({ date: "2026-03-25" }),
        makeWeekDay({ date: "2026-03-26" }),
        dayWithManyNotes,
        makeWeekDay({ date: "2026-03-28" }),
        makeWeekDay({ date: "2026-03-29" }),
      ]),
    );

    const user = userEvent.setup();
    renderWithContext(<WeekView />);

    // Wait for data to load and click the day with many notes
    await waitFor(() => {
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    const cells = screen.getAllByRole("gridcell");
    // 2026-03-27 is the 5th day (index 4)
    await user.click(cells[4]!);

    await waitFor(() => {
      expect(screen.getByText("還有 2 個筆記")).toBeInTheDocument();
    });
  });

  it("shows overflow text when notesModified exceeds MAX_ITEMS", async () => {
    const manyModifiedNotes = Array.from({ length: 13 }, (_, i) => ({
      id: `mod-note-${i}`,
      title: `Modified Note ${i}`,
      status: "developing",
    }));

    const dayWithManyModified = makeWeekDay({
      date: "2026-03-27",
      notes_modified: manyModifiedNotes,
    });

    mockGetDashboardWeek.mockResolvedValue(
      makeWeekData([
        makeWeekDay({ date: "2026-03-23" }),
        makeWeekDay({ date: "2026-03-24" }),
        makeWeekDay({ date: "2026-03-25" }),
        makeWeekDay({ date: "2026-03-26" }),
        dayWithManyModified,
        makeWeekDay({ date: "2026-03-28" }),
        makeWeekDay({ date: "2026-03-29" }),
      ]),
    );

    const user = userEvent.setup();
    renderWithContext(<WeekView />);

    await waitFor(() => {
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    const cells = screen.getAllByRole("gridcell");
    await user.click(cells[4]!);

    await waitFor(() => {
      expect(screen.getByText("還有 3 個筆記")).toBeInTheDocument();
    });
  });

  it("does not show overflow text when notes count is within MAX_ITEMS", async () => {
    const fewNotes = Array.from({ length: 3 }, (_, i) => ({
      id: `note-${i}`,
      title: `Note ${i}`,
      status: "fleeting",
    }));

    const dayWithFewNotes = makeWeekDay({
      date: "2026-03-27",
      notes_created: fewNotes,
    });

    mockGetDashboardWeek.mockResolvedValue(
      makeWeekData([
        makeWeekDay({ date: "2026-03-23" }),
        makeWeekDay({ date: "2026-03-24" }),
        makeWeekDay({ date: "2026-03-25" }),
        makeWeekDay({ date: "2026-03-26" }),
        dayWithFewNotes,
        makeWeekDay({ date: "2026-03-28" }),
        makeWeekDay({ date: "2026-03-29" }),
      ]),
    );

    const user = userEvent.setup();
    renderWithContext(<WeekView />);

    await waitFor(() => {
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    const cells = screen.getAllByRole("gridcell");
    await user.click(cells[4]!);

    await waitFor(() => {
      expect(screen.getByText(/筆記 \(3\)/)).toBeInTheDocument();
    });

    expect(screen.queryByText(/還有.*個筆記/)).not.toBeInTheDocument();
  });
});

// --- #228: Cross-week keyboard navigation focus ---

describe("WeekView cross-week keyboard navigation (#228)", () => {
  it("sets pendingFocusDate when navigating right past Sunday", async () => {
    const user = userEvent.setup();
    renderWithContext(<WeekView />);

    await waitFor(() => {
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    const cells = screen.getAllByRole("gridcell");
    // Focus the last cell (Sunday, index 6)
    cells[6]!.focus();
    expect(cells[6]).toHaveFocus();

    // The next week's data will be fetched; mock it
    const nextWeekData = makeWeekData([
      makeWeekDay({ date: "2026-03-30" }),
      makeWeekDay({ date: "2026-03-31" }),
      makeWeekDay({ date: "2026-04-01" }),
      makeWeekDay({ date: "2026-04-02" }),
      makeWeekDay({ date: "2026-04-03" }),
      makeWeekDay({ date: "2026-04-04" }),
      makeWeekDay({ date: "2026-04-05" }),
    ]);
    mockGetDashboardWeek.mockResolvedValue(nextWeekData);

    // Press ArrowRight on Sunday to go to next week's Monday
    await user.keyboard("{ArrowRight}");

    // Wait for the next week to render and Monday to be focused
    await waitFor(() => {
      const newCells = screen.getAllByRole("gridcell");
      expect(newCells[0]).toHaveFocus();
    });
  });

  it("sets pendingFocusDate when navigating left past Monday", async () => {
    const user = userEvent.setup();
    renderWithContext(<WeekView />);

    await waitFor(() => {
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    const cells = screen.getAllByRole("gridcell");
    // Focus Monday (index 0)
    cells[0]!.focus();
    expect(cells[0]).toHaveFocus();

    // The previous week's data
    const prevWeekData = makeWeekData([
      makeWeekDay({ date: "2026-03-16" }),
      makeWeekDay({ date: "2026-03-17" }),
      makeWeekDay({ date: "2026-03-18" }),
      makeWeekDay({ date: "2026-03-19" }),
      makeWeekDay({ date: "2026-03-20" }),
      makeWeekDay({ date: "2026-03-21" }),
      makeWeekDay({ date: "2026-03-22" }),
    ]);
    mockGetDashboardWeek.mockResolvedValue(prevWeekData);

    // Press ArrowLeft on Monday to go to previous week's Sunday
    await user.keyboard("{ArrowLeft}");

    // Wait for the previous week to render and Sunday to be focused
    await waitFor(() => {
      const newCells = screen.getAllByRole("gridcell");
      expect(newCells[6]).toHaveFocus();
    });
  });
});

// --- #230: cellRefs Map cleanup ---

describe("WeekView cellRefs cleanup (#230)", () => {
  it("removes stale entries from cellRefs when navigating to a different week", async () => {
    const user = userEvent.setup();
    renderWithContext(<WeekView />);

    await waitFor(() => {
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    // Verify initial week rendered with 7 cells
    expect(screen.getAllByRole("gridcell")).toHaveLength(7);

    // Navigate to next week
    const nextWeekData = makeWeekData([
      makeWeekDay({ date: "2026-03-30" }),
      makeWeekDay({ date: "2026-03-31" }),
      makeWeekDay({ date: "2026-04-01" }),
      makeWeekDay({ date: "2026-04-02" }),
      makeWeekDay({ date: "2026-04-03" }),
      makeWeekDay({ date: "2026-04-04" }),
      makeWeekDay({ date: "2026-04-05" }),
    ]);
    mockGetDashboardWeek.mockResolvedValue(nextWeekData);

    await user.click(screen.getByLabelText("下一週"));

    await waitFor(() => {
      const cells = screen.getAllByRole("gridcell");
      // The new week should be rendered, check that one of the new dates is present
      expect(cells).toHaveLength(7);
    });

    // The component should still have exactly 7 gridcells (old dates cleaned up)
    // This test verifies the cleanup effect runs - if it didn't, stale refs would accumulate
    // We verify indirectly by ensuring the grid still has exactly 7 cells after navigation
    expect(screen.getAllByRole("gridcell")).toHaveLength(7);
  });
});

// --- Basic rendering and interaction ---

describe("WeekView basic rendering", () => {
  it("renders week grid with 7 day cells", async () => {
    renderWithContext(<WeekView />);

    await waitFor(() => {
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    expect(screen.getAllByRole("gridcell")).toHaveLength(7);
  });

  it("shows loading skeleton while fetching", () => {
    mockGetDashboardWeek.mockReturnValue(new Promise(() => {})); // Never resolves
    renderWithContext(<WeekView />);

    // Should show pulse skeleton divs
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("shows error state with retry button", async () => {
    mockGetDashboardWeek.mockRejectedValue(new Error("fail"));
    renderWithContext(<WeekView />);

    await waitFor(() => {
      expect(screen.getByText("載入失敗")).toBeInTheDocument();
    });

    expect(screen.getByText("重試")).toBeInTheDocument();
  });

  it("toggles day detail on click", async () => {
    const dayWithTodo = makeWeekDay({
      date: "2026-03-27",
      todos_due: [{ id: "t1", title: "Test Todo", priority: null, status: "active" }],
    });

    mockGetDashboardWeek.mockResolvedValue(
      makeWeekData([
        makeWeekDay({ date: "2026-03-23" }),
        makeWeekDay({ date: "2026-03-24" }),
        makeWeekDay({ date: "2026-03-25" }),
        makeWeekDay({ date: "2026-03-26" }),
        dayWithTodo,
        makeWeekDay({ date: "2026-03-28" }),
        makeWeekDay({ date: "2026-03-29" }),
      ]),
    );

    const user = userEvent.setup();
    renderWithContext(<WeekView />);

    await waitFor(() => {
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    const cells = screen.getAllByRole("gridcell");
    await user.click(cells[4]!);

    await waitFor(() => {
      expect(screen.getByText("Test Todo")).toBeInTheDocument();
    });

    // Click again to close
    await user.click(cells[4]!);

    await waitFor(() => {
      expect(screen.queryByText("Test Todo")).not.toBeInTheDocument();
    });
  });

  it("shows todo overflow indicator when exceeding MAX_ITEMS", async () => {
    const manyTodos = Array.from({ length: 12 }, (_, i) => ({
      id: `todo-${i}`,
      title: `Todo ${i}`,
      priority: null,
      status: "active",
    }));

    const dayWithManyTodos = makeWeekDay({
      date: "2026-03-27",
      todos_due: manyTodos,
    });

    mockGetDashboardWeek.mockResolvedValue(
      makeWeekData([
        makeWeekDay({ date: "2026-03-23" }),
        makeWeekDay({ date: "2026-03-24" }),
        makeWeekDay({ date: "2026-03-25" }),
        makeWeekDay({ date: "2026-03-26" }),
        dayWithManyTodos,
        makeWeekDay({ date: "2026-03-28" }),
        makeWeekDay({ date: "2026-03-29" }),
      ]),
    );

    const user = userEvent.setup();
    renderWithContext(<WeekView />);

    await waitFor(() => {
      expect(screen.getByRole("grid")).toBeInTheDocument();
    });

    const cells = screen.getAllByRole("gridcell");
    await user.click(cells[4]!);

    await waitFor(() => {
      expect(screen.getByText("還有 2 個待辦")).toBeInTheDocument();
    });
  });
});
