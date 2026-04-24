import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PauseToggle } from "@/components/pause-toggle";
import type { ParsedItem } from "@/lib/types";
import * as api from "@/lib/api";
import { toast } from "sonner";
import { renderWithContext } from "@/test-utils";

vi.mock("@/lib/api");

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

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

function renderPauseToggle(
  item: ParsedItem,
  options: { isOnline?: boolean; onItemUpdate?: ReturnType<typeof vi.fn> } = {},
) {
  const onItemUpdate = options.onItemUpdate ?? vi.fn();
  return {
    onItemUpdate,
    ...renderWithContext(
      <PauseToggle item={item} isOnline={options.isOnline ?? true} onItemUpdate={onItemUpdate} />,
    ),
  };
}

describe("PauseToggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Polyfills for Radix Popover in jsdom
    window.HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    // @ts-expect-error ResizeObserver mock
    window.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows pause button for non-paused item", () => {
    renderPauseToggle(makeItem());
    expect(screen.getByRole("button", { name: /暫停/ })).toBeInTheDocument();
  });

  it("shows resume button for paused item", () => {
    renderPauseToggle(
      makeItem({ paused: 1, paused_at: "2026-01-01T00:00:00Z", paused_context: "waiting" }),
    );
    expect(screen.getByRole("button", { name: /恢復/ })).toBeInTheDocument();
  });

  it("disables pause button when offline", () => {
    renderPauseToggle(makeItem(), { isOnline: false });
    expect(screen.getByRole("button", { name: /暫停/ })).toBeDisabled();
  });

  it("disables resume button when offline", () => {
    renderPauseToggle(makeItem({ paused: 1, paused_at: "2026-01-01T00:00:00Z" }), {
      isOnline: false,
    });
    expect(screen.getByRole("button", { name: /恢復/ })).toBeDisabled();
  });

  it("opens popover when clicking pause", async () => {
    const user = userEvent.setup();
    renderPauseToggle(makeItem());

    await user.click(screen.getByRole("button", { name: /暫停/ }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("下次回來時，你想記住什麼？")).toBeInTheDocument();
    });
    expect(screen.getByText("0/500")).toBeInTheDocument();
    expect(screen.getByText("不附備忘直接暫停")).toBeInTheDocument();
  });

  it("pauses without context when clicking shortcut", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateItem).mockResolvedValue(makeItem({ paused: 1 }) as never);

    const { onItemUpdate } = renderPauseToggle(makeItem());

    await user.click(screen.getByRole("button", { name: /暫停/ }));
    await waitFor(() => {
      expect(screen.getByText("不附備忘直接暫停")).toBeInTheDocument();
    });

    await user.click(screen.getByText("不附備忘直接暫停"));

    await waitFor(() => {
      expect(api.updateItem).toHaveBeenCalledWith("test-1", { paused: true });
    });
    expect(onItemUpdate).toHaveBeenCalled();
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("已暫停");
    });
  });

  it("resumes immediately on click", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateItem).mockResolvedValue(makeItem({ paused: 0 }) as never);

    const { onItemUpdate } = renderPauseToggle(
      makeItem({ paused: 1, paused_at: "2026-01-01T00:00:00Z" }),
    );

    await user.click(screen.getByRole("button", { name: /恢復/ }));

    await waitFor(() => {
      expect(api.updateItem).toHaveBeenCalledWith("test-1", { paused: false });
    });
    expect(onItemUpdate).toHaveBeenCalled();
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("已恢復");
    });
  });

  it("shows error toast on pause failure and rolls back", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateItem).mockRejectedValue(new Error("Network error"));

    const { onItemUpdate } = renderPauseToggle(makeItem());

    await user.click(screen.getByRole("button", { name: /暫停/ }));
    await waitFor(() => {
      expect(screen.getByText("不附備忘直接暫停")).toBeInTheDocument();
    });
    await user.click(screen.getByText("不附備忘直接暫停"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Network error");
    });
    // Called twice: once for optimistic update, once for rollback
    expect(onItemUpdate).toHaveBeenCalledTimes(2);
  });

  it("shows error toast on resume failure and rolls back", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateItem).mockRejectedValue(new Error("Network error"));

    const { onItemUpdate } = renderPauseToggle(
      makeItem({ paused: 1, paused_at: "2026-01-01T00:00:00Z" }),
    );

    await user.click(screen.getByRole("button", { name: /恢復/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Network error");
    });
    // Called twice: once for optimistic update, once for rollback
    expect(onItemUpdate).toHaveBeenCalledTimes(2);
  });
});
