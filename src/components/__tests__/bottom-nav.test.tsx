import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithContext } from "@/test-utils";
import { BottomNav } from "../bottom-nav";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BottomNav", () => {
  it("renders 5 main nav tabs plus more button", () => {
    renderWithContext(<BottomNav />);

    expect(screen.getByText("筆記")).toBeInTheDocument();
    expect(screen.getByText("待辦")).toBeInTheDocument();
    expect(screen.getByText("暫存")).toBeInTheDocument();
    expect(screen.getByText("儀表板")).toBeInTheDocument();
    expect(screen.getByText("搜尋")).toBeInTheDocument();
    expect(screen.getByText("更多")).toBeInTheDocument();
  });

  it("highlights the current view tab", () => {
    renderWithContext(<BottomNav />, { currentView: "todos" });

    const todosButton = screen.getByText("待辦").closest("button")!;
    expect(todosButton.className).toContain("text-primary");

    const notesButton = screen.getByText("筆記").closest("button")!;
    expect(notesButton.className).toContain("text-muted-foreground");
  });

  it("calls onViewChange when clicking a tab", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    renderWithContext(<BottomNav />, { onViewChange });

    await user.click(screen.getByText("暫存"));
    expect(onViewChange).toHaveBeenCalledWith("scratch");
  });

  it("opens more menu when clicking 更多", async () => {
    const user = userEvent.setup();
    renderWithContext(<BottomNav />);

    expect(screen.queryByText("全部")).not.toBeInTheDocument();

    await user.click(screen.getByText("更多"));

    expect(screen.getByText("全部")).toBeInTheDocument();
    expect(screen.getByText("已封存")).toBeInTheDocument();
    expect(screen.getByText("設定")).toBeInTheDocument();
  });

  it("clicking a more menu item calls onViewChange and closes menu", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    renderWithContext(<BottomNav />, { onViewChange });

    await user.click(screen.getByText("更多"));
    await user.click(screen.getByText("設定"));

    expect(onViewChange).toHaveBeenCalledWith("settings");
    expect(screen.queryByText("全部")).not.toBeInTheDocument();
  });

  it("closes more menu when clicking overlay", async () => {
    const user = userEvent.setup();
    renderWithContext(<BottomNav />);

    await user.click(screen.getByText("更多"));
    expect(screen.getByText("全部")).toBeInTheDocument();

    // Click the overlay (the fixed inset-0 div)
    const overlay = screen.getByText("全部").closest(".absolute")!.parentElement!;
    await user.click(overlay);

    expect(screen.queryByText("全部")).not.toBeInTheDocument();
  });

  it("highlights 更多 button when a more-menu view is active", () => {
    renderWithContext(<BottomNav />, { currentView: "settings" });

    const moreButton = screen.getByText("更多").closest("button")!;
    expect(moreButton.className).toContain("text-primary");
  });
});
