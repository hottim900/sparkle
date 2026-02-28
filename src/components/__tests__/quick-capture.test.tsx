import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuickCapture } from "../quick-capture";
import { renderWithContext } from "@/test-utils";

const mockCreateItem = vi.fn().mockResolvedValue({});
const mockGetTags = vi.fn().mockResolvedValue({ tags: ["existing-tag"] });

vi.mock("@/lib/api", () => ({
  createItem: (...args: unknown[]) => mockCreateItem(...args),
  getTags: (...args: unknown[]) => mockGetTags(...args),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function getSubmitButton(): HTMLButtonElement {
  const form = document.querySelector("form")!;
  return form.querySelector('button[type="submit"]') as HTMLButtonElement;
}

describe("QuickCapture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders with note placeholder by default", async () => {
    renderWithContext(<QuickCapture />, { currentView: "notes" });
    await waitFor(() => {
      expect(screen.getByPlaceholderText("快速記錄...")).toBeInTheDocument();
    });
  });

  it("renders with todo placeholder when in todos view", async () => {
    renderWithContext(<QuickCapture />, { currentView: "todos" });
    await waitFor(() => {
      expect(screen.getByPlaceholderText("新增待辦...")).toBeInTheDocument();
    });
  });

  it("renders with scratch placeholder when in scratch view", async () => {
    renderWithContext(<QuickCapture />, { currentView: "scratch" });
    await waitFor(() => {
      expect(screen.getByPlaceholderText("暫存筆記...")).toBeInTheDocument();
    });
  });

  it("renders type buttons for note, todo, scratch", async () => {
    renderWithContext(<QuickCapture />, { currentView: "notes" });
    await waitFor(() => {
      expect(screen.getByText("筆記")).toBeInTheDocument();
    });
    expect(screen.getByText("待辦")).toBeInTheDocument();
    expect(screen.getByText("暫存")).toBeInTheDocument();
  });

  it("switches type when clicking type buttons", async () => {
    const user = userEvent.setup();
    renderWithContext(<QuickCapture />, { currentView: "notes" });

    await waitFor(() => {
      expect(screen.getByText("待辦")).toBeInTheDocument();
    });

    await user.click(screen.getByText("待辦"));
    expect(screen.getByPlaceholderText("新增待辦...")).toBeInTheDocument();
  });

  it("submit button is disabled when title is empty", async () => {
    renderWithContext(<QuickCapture />, { currentView: "notes" });
    await waitFor(() => {
      expect(getSubmitButton()).toBeDisabled();
    });
  });

  it("calls createItem on form submit", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    renderWithContext(<QuickCapture onCreated={onCreated} />, { currentView: "notes" });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("快速記錄...")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("快速記錄...");
    await user.type(input, "New Note Title");
    await user.click(getSubmitButton());

    await waitFor(() => {
      expect(mockCreateItem).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "New Note Title",
          type: "note",
        }),
      );
    });
  });

  it("clears input after successful submit", async () => {
    const user = userEvent.setup();
    renderWithContext(<QuickCapture />, { currentView: "notes" });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("快速記錄...")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("快速記錄...") as HTMLInputElement;
    await user.type(input, "New Note");
    await user.click(getSubmitButton());

    await waitFor(() => {
      expect(input.value).toBe("");
    });
  });

  it("submits on Enter key", async () => {
    const user = userEvent.setup();
    renderWithContext(<QuickCapture />, { currentView: "notes" });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("快速記錄...")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("快速記錄...");
    await user.type(input, "Enter Note{Enter}");

    await waitFor(() => {
      expect(mockCreateItem).toHaveBeenCalled();
    });
  });

  it("shows GTD tags only for todo type when expanded", async () => {
    const user = userEvent.setup();
    renderWithContext(<QuickCapture />, { currentView: "todos" });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("新增待辦...")).toBeInTheDocument();
    });

    // Find and click the expand/chevron button inside the form
    const form = document.querySelector("form")!;
    const formButtons = form.querySelectorAll('button[type="button"]');
    // The expand button is the one that's not the theme toggle
    // In form: theme toggle (md:hidden), chevron expand, (submit is type="submit")
    // Click the last type="button" in the form (chevron)
    const chevronBtn = formButtons[formButtons.length - 1]!;
    await user.click(chevronBtn);

    // GTD tags should be visible for todo type
    expect(screen.getByText("下一步")).toBeInTheDocument();
    expect(screen.getByText("等待中")).toBeInTheDocument();
    expect(screen.getByText("有一天")).toBeInTheDocument();
  });
});
