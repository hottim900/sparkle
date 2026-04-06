import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemContentEditor } from "../item-content-editor";

vi.mock("@/components/markdown-preview", () => ({
  MarkdownPreview: ({ content }: { content: string }) => (
    <div data-testid="markdown-preview">{content}</div>
  ),
}));

describe("ItemContentEditor", () => {
  const defaultProps = {
    content: "Hello **world**",
    onChange: vi.fn(),
    onBlur: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders preview by default", async () => {
    render(<ItemContentEditor {...defaultProps} />);
    expect(screen.queryByPlaceholderText("Markdown 內容...")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });
  });

  it("textarea shows content value after clicking edit", async () => {
    const user = userEvent.setup();
    render(<ItemContentEditor {...defaultProps} />);
    await user.click(screen.getByText("編輯"));
    const textarea = screen.getByPlaceholderText("Markdown 內容...") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Hello **world**");
  });

  it("onChange triggers when typing in textarea", async () => {
    const user = userEvent.setup();
    render(<ItemContentEditor {...defaultProps} />);
    await user.click(screen.getByText("編輯"));
    const textarea = screen.getByPlaceholderText("Markdown 內容...");
    fireEvent.change(textarea, { target: { value: "new content" } });
    expect(defaultProps.onChange).toHaveBeenCalledWith("new content");
  });

  it("onBlur triggers when textarea loses focus", async () => {
    const user = userEvent.setup();
    render(<ItemContentEditor {...defaultProps} />);
    await user.click(screen.getByText("編輯"));
    const textarea = screen.getByPlaceholderText("Markdown 內容...");
    fireEvent.blur(textarea);
    expect(defaultProps.onBlur).toHaveBeenCalled();
  });

  it("switches to edit mode when clicking 編輯 button", async () => {
    const user = userEvent.setup();
    render(<ItemContentEditor {...defaultProps} />);

    await user.click(screen.getByText("編輯"));
    expect(screen.getByPlaceholderText("Markdown 內容...")).toBeInTheDocument();
    expect(screen.queryByTestId("markdown-preview")).not.toBeInTheDocument();
  });

  it("switches back to preview mode when clicking 預覽 button", async () => {
    const user = userEvent.setup();
    render(<ItemContentEditor {...defaultProps} />);

    // Switch to edit first
    await user.click(screen.getByText("編輯"));
    expect(screen.getByPlaceholderText("Markdown 內容...")).toBeInTheDocument();

    // Switch back to preview
    await user.click(screen.getByText("預覽"));
    expect(screen.queryByPlaceholderText("Markdown 內容...")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });
  });

  it("shows 無內容 on initial render when content is empty", async () => {
    render(<ItemContentEditor {...defaultProps} content="" />);
    await waitFor(() => {
      expect(screen.getByText("無內容")).toBeInTheDocument();
    });
  });

  it("shows offline warning in edit mode", async () => {
    const user = userEvent.setup();
    render(<ItemContentEditor {...defaultProps} offlineWarning />);
    // Not visible in default preview mode
    expect(screen.queryByText("離線中 — 編輯內容將不會自動儲存")).not.toBeInTheDocument();
    // Visible after switching to edit
    await user.click(screen.getByText("編輯"));
    expect(screen.getByText("離線中 — 編輯內容將不會自動儲存")).toBeInTheDocument();
  });

  it("does not show offline warning when offlineWarning is false", () => {
    render(<ItemContentEditor {...defaultProps} offlineWarning={false} />);
    expect(screen.queryByText("離線中 — 編輯內容將不會自動儲存")).not.toBeInTheDocument();
  });

  it("hides offline warning in preview mode (default)", () => {
    render(<ItemContentEditor {...defaultProps} offlineWarning />);
    expect(screen.queryByText("離線中 — 編輯內容將不會自動儲存")).not.toBeInTheDocument();
  });
});
