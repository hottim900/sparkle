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

  it("renders textarea in edit mode by default", () => {
    render(<ItemContentEditor {...defaultProps} />);
    expect(screen.getByPlaceholderText("Markdown 內容...")).toBeInTheDocument();
  });

  it("textarea shows content value", () => {
    render(<ItemContentEditor {...defaultProps} />);
    const textarea = screen.getByPlaceholderText("Markdown 內容...") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Hello **world**");
  });

  it("onChange triggers when typing in textarea", () => {
    render(<ItemContentEditor {...defaultProps} />);
    const textarea = screen.getByPlaceholderText("Markdown 內容...");
    fireEvent.change(textarea, { target: { value: "new content" } });
    expect(defaultProps.onChange).toHaveBeenCalledWith("new content");
  });

  it("onBlur triggers when textarea loses focus", () => {
    render(<ItemContentEditor {...defaultProps} />);
    const textarea = screen.getByPlaceholderText("Markdown 內容...");
    fireEvent.blur(textarea);
    expect(defaultProps.onBlur).toHaveBeenCalled();
  });

  it("switches to preview mode when clicking 預覽 button", async () => {
    const user = userEvent.setup();
    render(<ItemContentEditor {...defaultProps} />);

    await user.click(screen.getByText("預覽"));

    // Textarea should be gone
    expect(screen.queryByPlaceholderText("Markdown 內容...")).not.toBeInTheDocument();
    // Preview content should be visible after lazy load
    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });
  });

  it("switches back to edit mode when clicking 編輯 button", async () => {
    const user = userEvent.setup();
    render(<ItemContentEditor {...defaultProps} />);

    await user.click(screen.getByText("預覽"));
    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    await user.click(screen.getByText("編輯"));
    expect(screen.getByPlaceholderText("Markdown 內容...")).toBeInTheDocument();
  });

  it("shows 無內容 when content is empty in preview mode", async () => {
    const user = userEvent.setup();
    render(<ItemContentEditor {...defaultProps} content="" />);

    await user.click(screen.getByText("預覽"));
    await waitFor(() => {
      expect(screen.getByText("無內容")).toBeInTheDocument();
    });
  });
});
