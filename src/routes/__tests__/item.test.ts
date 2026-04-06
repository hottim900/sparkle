import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTargetPath } from "@/routes/item.$id";
import type { Item } from "@/lib/types";

const mockGetItem = vi.fn();
const mockToastError = vi.fn();

vi.mock("@/lib/api", () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    get error() {
      return mockToastError;
    },
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  redirect: (opts: Record<string, unknown>) => {
    const r = new Response(null, { status: 307 });
    (r as Record<string, unknown>).options = opts;
    return r;
  },
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/loading-fallback", () => ({
  LoadingFallback: () => null,
}));

vi.mock("@/components/item-detail", () => ({
  ItemDetail: () => null,
}));

function makeItem(type: Item["type"], status: Item["status"]): Item {
  return {
    id: "test-id",
    type,
    status,
    title: "test",
    content: "",
    priority: null,
    due: null,
    tags: "[]",
    source: null,
    origin: "web",
    aliases: "[]",
    linked_note_id: null,
    linked_note_title: null,
    linked_todo_count: 0,
    share_visibility: null,
    category_id: null,
    category_name: null,
    viewed_at: null,
    is_private: false,
    export_path: null,
    paused: 0,
    paused_at: null,
    paused_context: null,
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
  };
}

describe("getTargetPath", () => {
  it("maps note+fleeting to /notes/fleeting", () => {
    expect(getTargetPath(makeItem("note", "fleeting"))).toBe("/notes/fleeting");
  });

  it("maps note+developing to /notes/developing", () => {
    expect(getTargetPath(makeItem("note", "developing"))).toBe("/notes/developing");
  });

  it("maps note+permanent to /notes/permanent", () => {
    expect(getTargetPath(makeItem("note", "permanent"))).toBe("/notes/permanent");
  });

  it("maps note+exported to null (standalone view)", () => {
    expect(getTargetPath(makeItem("note", "exported"))).toBeNull();
  });

  it("maps note+archived to /archived", () => {
    expect(getTargetPath(makeItem("note", "archived"))).toBe("/archived");
  });

  it("maps todo+active to /todos", () => {
    expect(getTargetPath(makeItem("todo", "active"))).toBe("/todos");
  });

  it("maps todo+done to /todos/done", () => {
    expect(getTargetPath(makeItem("todo", "done"))).toBe("/todos/done");
  });

  it("maps todo+archived to /archived", () => {
    expect(getTargetPath(makeItem("todo", "archived"))).toBe("/archived");
  });

  it("maps scratch+draft to /scratch", () => {
    expect(getTargetPath(makeItem("scratch", "draft"))).toBe("/scratch");
  });

  it("maps scratch+archived to /archived", () => {
    expect(getTargetPath(makeItem("scratch", "archived"))).toBe("/archived");
  });

  it("falls back to /dashboard for unknown type", () => {
    const item = makeItem("note", "fleeting");
    (item as unknown as { type: string }).type = "unknown";
    expect(getTargetPath(item as Item)).toBe("/dashboard");
  });
});

// Import Route after mocks are set up
const { Route } = await import("@/routes/item.$id");
const loader = (Route as Record<string, unknown>).loader as (ctx: {
  params: { id: string };
}) => Promise<{ item: Item }>;

describe("item.$id loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects note+fleeting to /notes/fleeting with ?item= param", async () => {
    const item = makeItem("note", "fleeting");
    mockGetItem.mockResolvedValue(item);

    await expect(loader({ params: { id: "abc123" } })).rejects.toSatisfy((err: Response) => {
      expect(err).toBeInstanceOf(Response);
      const opts = (err as Record<string, unknown>).options as Record<string, unknown>;
      expect(opts.to).toBe("/notes/fleeting");
      expect(opts.search).toEqual({ item: "abc123" });
      return true;
    });
  });

  it("redirects todo+active to /todos with ?item= param", async () => {
    const item = makeItem("todo", "active");
    mockGetItem.mockResolvedValue(item);

    await expect(loader({ params: { id: "todo-1" } })).rejects.toSatisfy((err: Response) => {
      const opts = (err as Record<string, unknown>).options as Record<string, unknown>;
      expect(opts.to).toBe("/todos");
      expect(opts.search).toEqual({ item: "todo-1" });
      return true;
    });
  });

  it("returns item for note+exported (standalone view, no redirect)", async () => {
    const item = makeItem("note", "exported");
    mockGetItem.mockResolvedValue(item);

    const result = await loader({ params: { id: "exp-1" } });
    expect(result).toEqual({ item });
  });

  it("shows toast and redirects to /dashboard on 404 error", async () => {
    mockGetItem.mockRejectedValue(new Error("Not found"));

    await expect(loader({ params: { id: "nonexistent" } })).rejects.toSatisfy((err: Response) => {
      expect(err).toBeInstanceOf(Response);
      const opts = (err as Record<string, unknown>).options as Record<string, unknown>;
      expect(opts.to).toBe("/dashboard");
      return true;
    });
    expect(mockToastError).toHaveBeenCalledWith("找不到此項目");
  });

  it("shows toast and redirects to /dashboard on network error", async () => {
    mockGetItem.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(loader({ params: { id: "net-fail" } })).rejects.toSatisfy((err: Response) => {
      expect(err).toBeInstanceOf(Response);
      const opts = (err as Record<string, unknown>).options as Record<string, unknown>;
      expect(opts.to).toBe("/dashboard");
      return true;
    });
    expect(mockToastError).toHaveBeenCalledWith("找不到此項目");
  });
});
