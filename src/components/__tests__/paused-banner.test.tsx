import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PausedBanner } from "@/components/paused-banner";
import type { ParsedItem } from "@/lib/types";

function makeItem(overrides: Partial<ParsedItem> = {}): ParsedItem {
  return {
    id: "test-1",
    type: "note",
    title: "Test Note",
    content: "",
    status: "fleeting",
    priority: null,
    due: null,
    tags: [],
    source: null,
    origin_source: "web",

    origin: "active",
    aliases: [],
    linked_note_id: null,
    linked_note_title: null,
    linked_todo_count: 0,
    share_visibility: null,
    category_id: null,
    category_name: null,
    viewed_at: "2026-01-01T00:00:00.000Z",
    is_private: 0,
    paused: 0,
    paused_at: null,
    paused_context: null,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("PausedBanner", () => {
  it("renders nothing for non-paused item", () => {
    const { container } = render(
      <PausedBanner item={makeItem()} isOnline={true} onResume={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders banner with context for paused item", () => {
    render(
      <PausedBanner
        item={makeItem({ paused: 1, paused_at: "2026-01-01T00:00:00Z", paused_context: "等回覆" })}
        isOnline={true}
        onResume={vi.fn()}
      />,
    );
    expect(screen.getByText("等回覆")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /恢復/ })).toBeInTheDocument();
  });

  it("shows default text when no context", () => {
    render(
      <PausedBanner
        item={makeItem({ paused: 1, paused_at: "2026-01-01T00:00:00Z" })}
        isOnline={true}
        onResume={vi.fn()}
      />,
    );
    expect(screen.getByText("已暫停")).toBeInTheDocument();
  });

  it("calls onResume when clicking resume button", async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();

    render(
      <PausedBanner
        item={makeItem({ paused: 1, paused_at: "2026-01-01T00:00:00Z" })}
        isOnline={true}
        onResume={onResume}
      />,
    );

    await user.click(screen.getByRole("button", { name: /恢復/ }));
    expect(onResume).toHaveBeenCalled();
  });

  it("disables resume button when offline", () => {
    render(
      <PausedBanner
        item={makeItem({ paused: 1, paused_at: "2026-01-01T00:00:00Z" })}
        isOnline={false}
        onResume={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /恢復/ })).toBeDisabled();
  });
});
