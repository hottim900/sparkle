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

let mockPathname = "/notes/fleeting";

vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: mockPathname, search: {} } }),
}));

function getSubmitButton(): HTMLButtonElement {
  const form = document.querySelector("form")!;
  return form.querySelector('button[type="submit"]') as HTMLButtonElement;
}

describe("QuickCapture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = "/notes/fleeting";
    localStorage.clear();
  });

  // ============================================================
  // Input type rendering (textarea vs input)
  // ============================================================
  it("renders textarea for note type", async () => {
    renderWithContext(<QuickCapture />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("打下你的想法... 第一行會成為標題")).toBeInTheDocument();
    });
    const el = screen.getByPlaceholderText("打下你的想法... 第一行會成為標題");
    expect(el.tagName).toBe("TEXTAREA");
  });

  it("renders textarea for scratch type", async () => {
    mockPathname = "/scratch";
    renderWithContext(<QuickCapture />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("暫存筆記...")).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText("暫存筆記...").tagName).toBe("TEXTAREA");
  });

  it("renders input for todo type", async () => {
    mockPathname = "/todos";
    renderWithContext(<QuickCapture />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("新增待辦...")).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText("新增待辦...").tagName).toBe("INPUT");
  });

  // ============================================================
  // Keyboard behavior
  // ============================================================
  it("Enter creates newline in textarea (does not submit)", async () => {
    const user = userEvent.setup();
    renderWithContext(<QuickCapture />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("打下你的想法... 第一行會成為標題")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(
      "打下你的想法... 第一行會成為標題",
    ) as HTMLTextAreaElement;
    await user.type(textarea, "Line 1{Enter}Line 2");

    // Should NOT have submitted
    expect(mockCreateItem).not.toHaveBeenCalled();
    expect(textarea.value).toBe("Line 1\nLine 2");
  });

  it("Cmd+Enter submits textarea", async () => {
    const user = userEvent.setup();
    renderWithContext(<QuickCapture />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("打下你的想法... 第一行會成為標題")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText("打下你的想法... 第一行會成為標題");
    await user.type(textarea, "Hello World");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() => {
      expect(mockCreateItem).toHaveBeenCalled();
    });
  });

  it("Ctrl+Enter submits textarea", async () => {
    const user = userEvent.setup();
    renderWithContext(<QuickCapture />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("打下你的想法... 第一行會成為標題")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText("打下你的想法... 第一行會成為標題");
    await user.type(textarea, "Hello World");
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => {
      expect(mockCreateItem).toHaveBeenCalled();
    });
  });

  it("Enter submits for todo input", async () => {
    const user = userEvent.setup();
    mockPathname = "/todos";
    renderWithContext(<QuickCapture />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("新增待辦...")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("新增待辦...");
    await user.type(input, "Buy milk{Enter}");

    await waitFor(() => {
      expect(mockCreateItem).toHaveBeenCalled();
    });
  });

  // ============================================================
  // Payload — content vs title
  // ============================================================
  it("note submits content (no title) to API", async () => {
    const user = userEvent.setup();
    renderWithContext(<QuickCapture />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("打下你的想法... 第一行會成為標題")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText("打下你的想法... 第一行會成為標題");
    await user.type(textarea, "Hello{Enter}World");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() => {
      expect(mockCreateItem).toHaveBeenCalled();
    });
    const payload = mockCreateItem.mock.calls[0][0];
    expect(payload.content).toBe("Hello\nWorld");
    expect(payload.title).toBeUndefined();
    expect(payload.type).toBe("note");
  });

  it("todo submits title (no content) to API", async () => {
    const user = userEvent.setup();
    mockPathname = "/todos";
    renderWithContext(<QuickCapture />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("新增待辦...")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("新增待辦...");
    await user.type(input, "Buy milk{Enter}");

    await waitFor(() => {
      expect(mockCreateItem).toHaveBeenCalled();
    });
    const payload = mockCreateItem.mock.calls[0][0];
    expect(payload.title).toBe("Buy milk");
    expect(payload.content).toBeUndefined();
    expect(payload.type).toBe("todo");
  });

  // ============================================================
  // Submit button state
  // ============================================================
  it("submit button disabled when empty", async () => {
    renderWithContext(<QuickCapture />);
    await waitFor(() => {
      expect(getSubmitButton()).toBeDisabled();
    });
  });

  it("submit clears textarea after success", async () => {
    const user = userEvent.setup();
    renderWithContext(<QuickCapture />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("打下你的想法... 第一行會成為標題")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(
      "打下你的想法... 第一行會成為標題",
    ) as HTMLTextAreaElement;
    await user.type(textarea, "Some text");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() => {
      expect(textarea.value).toBe("");
    });
  });

  // ============================================================
  // Type switching
  // ============================================================
  it("type switch preserves text in textarea modes", async () => {
    const user = userEvent.setup();
    renderWithContext(<QuickCapture />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("打下你的想法... 第一行會成為標題")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(
      "打下你的想法... 第一行會成為標題",
    ) as HTMLTextAreaElement;
    await user.type(textarea, "My text");

    // Switch note → scratch
    await user.click(screen.getByText("暫存"));

    const scratchTextarea = screen.getByPlaceholderText("暫存筆記...") as HTMLTextAreaElement;
    expect(scratchTextarea.value).toBe("My text");
  });

  it("type switch from note to todo preserves text", async () => {
    const user = userEvent.setup();
    renderWithContext(<QuickCapture />);
    await waitFor(() => {
      expect(screen.getByPlaceholderText("打下你的想法... 第一行會成為標題")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText("打下你的想法... 第一行會成為標題");
    await user.type(textarea, "Some task text");

    // Switch note → todo
    await user.click(screen.getByText("待辦"));

    const input = screen.getByPlaceholderText("新增待辦...") as HTMLInputElement;
    expect(input.value).toBe("Some task text");
  });

  // ============================================================
  // Existing features still work
  // ============================================================
  it("renders type buttons for note, todo, scratch", async () => {
    renderWithContext(<QuickCapture />);
    await waitFor(() => {
      expect(screen.getByText("筆記")).toBeInTheDocument();
    });
    expect(screen.getByText("待辦")).toBeInTheDocument();
    expect(screen.getByText("暫存")).toBeInTheDocument();
  });

  it("shows GTD tags only for todo type when expanded", async () => {
    const user = userEvent.setup();
    mockPathname = "/todos";
    renderWithContext(<QuickCapture />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("新增待辦...")).toBeInTheDocument();
    });

    const form = document.querySelector("form")!;
    const formButtons = form.querySelectorAll('button[type="button"]');
    const chevronBtn = formButtons[formButtons.length - 1]!;
    await user.click(chevronBtn);

    expect(screen.getByText("下一步")).toBeInTheDocument();
    expect(screen.getByText("等待中")).toBeInTheDocument();
    expect(screen.getByText("有一天")).toBeInTheDocument();
  });

  it("shows offline hint when offline", () => {
    renderWithContext(<QuickCapture />, { isOnline: false });
    expect(screen.getByText(/離線模式/)).toBeInTheDocument();
  });

  it("keeps submit button enabled when offline with input", async () => {
    const user = userEvent.setup();
    renderWithContext(<QuickCapture />, { isOnline: false });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("打下你的想法... 第一行會成為標題")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText("打下你的想法... 第一行會成為標題");
    await user.type(textarea, "Offline note");

    expect(getSubmitButton()).not.toBeDisabled();
  });
});
