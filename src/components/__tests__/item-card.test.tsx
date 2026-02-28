import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemCard } from "../item-card";
import type { ParsedItem } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  updateItem: vi.fn().mockResolvedValue({}),
  deleteItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeItem(overrides: Partial<ParsedItem> = {}): ParsedItem {
  return {
    id: "item-1",
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
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ItemCard", () => {
  it("renders note title", () => {
    render(<ItemCard item={makeItem({ title: "My Note Title" })} />);
    expect(screen.getByText("My Note Title")).toBeInTheDocument();
  });

  it("renders tags", () => {
    render(<ItemCard item={makeItem({ tags: ["tag-a", "tag-b"] })} />);
    expect(screen.getByText("tag-a")).toBeInTheDocument();
    expect(screen.getByText("tag-b")).toBeInTheDocument();
  });

  it("applies priority border color for high priority", () => {
    const { container } = render(<ItemCard item={makeItem({ priority: "high" })} />);
    const card = container.firstElementChild!;
    expect(card.className).toContain("border-l-red-500");
  });

  it("applies priority border color for medium priority", () => {
    const { container } = render(<ItemCard item={makeItem({ priority: "medium" })} />);
    const card = container.firstElementChild!;
    expect(card.className).toContain("border-l-yellow-500");
  });

  it("applies done styling (opacity)", () => {
    const { container } = render(<ItemCard item={makeItem({ type: "todo", status: "done" })} />);
    const card = container.firstElementChild!;
    expect(card.className).toContain("opacity-60");
  });

  it("renders line-through for done todo title", () => {
    render(<ItemCard item={makeItem({ type: "todo", status: "done", title: "Done Task" })} />);
    const title = screen.getByText("Done Task");
    expect(title.className).toContain("line-through");
  });

  it("calls onSelect when card is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const item = makeItem();
    render(<ItemCard item={item} onSelect={onSelect} />);
    await user.click(screen.getByText("Test Note"));
    expect(onSelect).toHaveBeenCalledWith(item);
  });

  it("renders todo checkbox", () => {
    render(<ItemCard item={makeItem({ type: "todo", status: "active" })} />);
    // The checkbox button should exist
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it("renders linked todo count for notes", () => {
    render(<ItemCard item={makeItem({ type: "note", linked_todo_count: 3 })} />);
    expect(screen.getByText("3 待辦")).toBeInTheDocument();
  });

  it("renders due date for todos", () => {
    const futureDate = "2099-12-31";
    render(<ItemCard item={makeItem({ type: "todo", status: "active", due: futureDate })} />);
    expect(screen.getByText(futureDate)).toBeInTheDocument();
  });

  it("shows overdue styling for past-due active todos", () => {
    const { container } = render(
      <ItemCard item={makeItem({ type: "todo", status: "active", due: "2020-01-01" })} />,
    );
    const card = container.firstElementChild!;
    expect(card.className).toContain("ring-1");
  });

  it("uses selection mode when selectionMode is true", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<ItemCard item={makeItem()} selectionMode={true} checked={false} onToggle={onToggle} />);
    await user.click(screen.getByText("Test Note"));
    expect(onToggle).toHaveBeenCalledWith("item-1");
  });
});
