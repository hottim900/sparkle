import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TagInput } from "../tag-input";

describe("TagInput", () => {
  const defaultProps = {
    tags: ["existing", "tag2"],
    allTags: ["existing", "tag2", "suggestion1", "suggestion2", "other"],
    onAdd: vi.fn(),
    onRemove: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders existing tags as badges", () => {
    render(<TagInput {...defaultProps} />);
    expect(screen.getByText("existing")).toBeInTheDocument();
    expect(screen.getByText("tag2")).toBeInTheDocument();
  });

  it("calls onAdd when typing tag and pressing Enter", async () => {
    const user = userEvent.setup();
    render(<TagInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("新增標籤...");
    await user.type(input, "newtag{Enter}");

    expect(defaultProps.onAdd).toHaveBeenCalledWith("newtag");
  });

  it("clears input after adding tag", async () => {
    const user = userEvent.setup();
    render(<TagInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("新增標籤...") as HTMLInputElement;
    await user.type(input, "newtag{Enter}");

    expect(input.value).toBe("");
  });

  it("calls onRemove when clicking X on badge", async () => {
    const user = userEvent.setup();
    render(<TagInput {...defaultProps} />);

    const badge = screen.getByText("existing").closest(".gap-1")!;
    const removeBtn = badge.querySelector("button")!;
    await user.click(removeBtn);

    expect(defaultProps.onRemove).toHaveBeenCalledWith("existing");
  });

  it("does not call onAdd for duplicate tag", async () => {
    const user = userEvent.setup();
    render(<TagInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("新增標籤...");
    await user.type(input, "existing{Enter}");

    expect(defaultProps.onAdd).not.toHaveBeenCalled();
  });

  it("does not call onAdd for empty input", async () => {
    const user = userEvent.setup();
    render(<TagInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("新增標籤...");
    await user.click(input);
    await user.keyboard("{Enter}");

    expect(defaultProps.onAdd).not.toHaveBeenCalled();
  });

  it("shows filtered suggestions when typing", async () => {
    const user = userEvent.setup();
    render(<TagInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("新增標籤...");
    await user.type(input, "sug");

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("suggestion1")).toBeInTheDocument();
    expect(screen.getByText("suggestion2")).toBeInTheDocument();
  });

  it("does not show already-selected tags in suggestions", async () => {
    const user = userEvent.setup();
    render(<TagInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("新增標籤...");
    // "exist" matches "existing" which is already in tags
    await user.type(input, "exist");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("ArrowDown navigates suggestions", async () => {
    const user = userEvent.setup();
    render(<TagInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("新增標籤...");
    await user.type(input, "sug");

    // First suggestion is auto-highlighted (index 0)
    const option0 = screen.getByRole("option", { name: "suggestion1" });
    expect(option0).toHaveAttribute("aria-selected", "true");

    // ArrowDown moves to index 1
    await user.keyboard("{ArrowDown}");
    const option1 = screen.getByRole("option", { name: "suggestion2" });
    expect(option1).toHaveAttribute("aria-selected", "true");
    expect(option0).toHaveAttribute("aria-selected", "false");
  });

  it("Enter selects highlighted suggestion", async () => {
    const user = userEvent.setup();
    render(<TagInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("新增標籤...");
    await user.type(input, "sug");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(defaultProps.onAdd).toHaveBeenCalledWith("suggestion2");
  });

  it("Tab selects highlighted suggestion", async () => {
    const user = userEvent.setup();
    render(<TagInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("新增標籤...");
    await user.type(input, "sug");
    // First suggestion auto-highlighted
    await user.keyboard("{Tab}");

    expect(defaultProps.onAdd).toHaveBeenCalledWith("suggestion1");
  });

  it("Escape closes suggestions", async () => {
    const user = userEvent.setup();
    render(<TagInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("新增標籤...");
    await user.type(input, "sug");
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("clicking a suggestion calls onAdd", async () => {
    const user = userEvent.setup();
    render(<TagInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("新增標籤...");
    await user.type(input, "sug");

    await user.click(screen.getByText("suggestion1"));
    expect(defaultProps.onAdd).toHaveBeenCalledWith("suggestion1");
  });

  it("clicking add button adds the typed tag", async () => {
    const user = userEvent.setup();
    render(<TagInput {...defaultProps} />);

    const input = screen.getByPlaceholderText("新增標籤...");
    await user.type(input, "newtag");

    const addBtn = screen.getByRole("button", { name: "新增標籤" });
    await user.click(addBtn);

    expect(defaultProps.onAdd).toHaveBeenCalledWith("newtag");
    expect(input).toHaveValue("");
  });

  it("add button is hidden when input is empty", () => {
    render(<TagInput {...defaultProps} />);
    expect(screen.queryByRole("button", { name: "新增標籤" })).not.toBeInTheDocument();
  });

  it("has enterKeyHint=done for mobile keyboards", () => {
    render(<TagInput {...defaultProps} />);
    const input = screen.getByPlaceholderText("新增標籤...");
    expect(input).toHaveAttribute("enterkeyhint", "done");
  });
});
