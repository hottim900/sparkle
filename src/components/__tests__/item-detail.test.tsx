import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type AppContextValue } from "@/lib/app-context";
import { ItemDetail } from "@/components/item-detail";
import { PrivateItemDetail } from "@/routes/private";
import type { Item } from "@/lib/types";
import * as api from "@/lib/api";
import * as privateApi from "@/lib/private-api";
import { toast } from "sonner";
import { renderWithContext } from "@/test-utils";

vi.mock("@/lib/api");
vi.mock("@/lib/private-api");

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  createFileRoute: () => (options: unknown) => options,
}));

const mockItem: Item = {
  id: "test-1",
  type: "note",
  title: "Original Title",
  content: "Original content",
  status: "fleeting",
  priority: null,
  due: null,
  tags: "[]",
  source: null,
  origin_source: "web",

  origin: "active",
  aliases: "[]",
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
};

const mockTodoItem: Item = {
  ...mockItem,
  type: "todo",
  status: "active",
};

const mockScratchItem: Item = {
  ...mockItem,
  type: "scratch",
  status: "draft",
};

const mockPermanentNote: Item = {
  ...mockItem,
  status: "permanent",
};

const mockItemWithAliases: Item = {
  ...mockItem,
  aliases: '["alias-one","alias-two"]',
};

const mockPrivateItem: Item = {
  ...mockItem,
  id: "private-test-1",
  title: "私密原標題",
  content: "私密原內容",
  is_private: 1,
};

function renderItemDetail(
  contextOverrides: Partial<AppContextValue> = {},
  props: { onDeleted?: () => void } = {},
) {
  return renderWithContext(<ItemDetail itemId="test-1" {...props} />, contextOverrides);
}

function setupDefaultMocks(item: Item = mockItem) {
  vi.mocked(api.getItem).mockResolvedValue(item);
  vi.mocked(api.getTags).mockResolvedValue({ tags: [] });
  vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.listCategories).mockResolvedValue({ categories: [] });
}

describe("ItemDetail auto-save", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should not overwrite title with server response during typing", async () => {
    // Control when updateItem resolves to simulate network delay
    let resolveUpdate!: (value: Item) => void;
    vi.mocked(api.updateItem).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    renderItemDetail();

    // Flush React Query scheduling + microtasks with fake timers
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    expect(titleInput).toHaveValue("Original Title");

    // Step 1: User types "New Ti" (simulated as a single change event)
    fireEvent.change(titleInput, { target: { value: "New Ti" } });
    expect(titleInput).toHaveValue("New Ti");

    // Step 2: Debounce fires after 1500ms — saveField("title", "New Ti") starts
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(api.updateItem).toHaveBeenCalledWith("test-1", { title: "New Ti" });

    // Step 3: While save is in flight, user continues typing to "New Title"
    fireEvent.change(titleInput, { target: { value: "New Title" } });

    // Step 4: Server responds with stale value "New Ti"
    await act(async () => {
      resolveUpdate({ ...mockItem, title: "New Ti", modified: "2026-01-01T00:01:00.000Z" });
    });

    // Title input should show "New Title" (user's latest), NOT "New Ti" (server's stale response)
    expect(titleInput).toHaveValue("New Title");
  });
});

describe("ItemDetail loading and error states", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading state while fetching", () => {
    vi.mocked(api.getItem).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.getTags).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });

    renderItemDetail();
    expect(screen.getByText("載入中...")).toBeInTheDocument();
  });

  it("shows error toast on API failure", async () => {
    vi.mocked(api.getItem).mockRejectedValue(new Error("Network error"));
    vi.mocked(api.getTags).mockResolvedValue({ tags: [] });
    vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });

    renderItemDetail();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Network error");
    });
  });

  it("shows not found message when item fails to load", async () => {
    vi.mocked(api.getItem).mockRejectedValue(new Error("Not found"));
    vi.mocked(api.getTags).mockResolvedValue({ tags: [] });
    vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });

    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("找不到項目")).toBeInTheDocument();
    });
  });
});

describe("ItemDetail title editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setupDefaultMocks();
    vi.mocked(api.updateItem).mockResolvedValue({
      ...mockItem,
      modified: "2026-01-01T00:01:00.000Z",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounced save triggers after 1500ms", async () => {
    vi.mocked(api.updateItem).mockReturnValue(new Promise(() => {}));
    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "Updated Title" } });

    // Not called yet before debounce
    expect(api.updateItem).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1500);
    });

    expect(api.updateItem).toHaveBeenCalledWith("test-1", { title: "Updated Title" });
  });

  it("blur triggers immediate save when debounce is pending", async () => {
    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "Blur Save" } });

    // Debounce not yet fired
    expect(api.updateItem).not.toHaveBeenCalled();

    // Blur should cancel debounce and immediately save
    await act(async () => {
      fireEvent.blur(titleInput);
    });

    expect(api.updateItem).toHaveBeenCalledWith("test-1", { title: "Blur Save" });
  });

  it("does not save an intermediate IME composition value", async () => {
    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.compositionStart(titleInput);
    fireEvent.change(titleInput, { target: { value: "ㄓ" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.updateItem).not.toHaveBeenCalled();

    fireEvent.change(titleInput, { target: { value: "中" } });
    fireEvent.compositionEnd(titleInput, { data: "中" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(api.updateItem).toHaveBeenCalledWith("test-1", { title: "中" });
  });

  it("does not flush an intermediate IME value when the title blurs during composition", async () => {
    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.compositionStart(titleInput);
    fireEvent.change(titleInput, { target: { value: "ㄓ" } });
    fireEvent.blur(titleInput);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.updateItem).not.toHaveBeenCalled();

    fireEvent.change(titleInput, { target: { value: "中" } });
    fireEvent.compositionEnd(titleInput, { data: "中" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(api.updateItem).toHaveBeenCalledWith("test-1", { title: "中" });
  });

  it("uses native isComposing as a fallback without requiring compositionEnd", async () => {
    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.input(titleInput, {
      target: { value: "ㄓ" },
      isComposing: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.updateItem).not.toHaveBeenCalled();

    fireEvent.input(titleInput, {
      target: { value: "中" },
      isComposing: false,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(api.updateItem).toHaveBeenCalledWith("test-1", { title: "中" });
  });

  it("cancels an existing debounce when IME composition starts", async () => {
    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "已提交" } });
    fireEvent.compositionStart(titleInput);
    fireEvent.change(titleInput, { target: { value: "已提交ㄓ" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.updateItem).not.toHaveBeenCalled();

    fireEvent.change(titleInput, { target: { value: "已提交中" } });
    fireEvent.compositionEnd(titleInput, { data: "中" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(api.updateItem).toHaveBeenCalledWith("test-1", { title: "已提交中" });
  });

  it("does not let an earlier save response overwrite an active IME composition", async () => {
    let resolveUpdate!: (value: Item) => void;
    vi.mocked(api.updateItem).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "已提交" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(api.updateItem).toHaveBeenCalledWith("test-1", { title: "已提交" });

    fireEvent.compositionStart(titleInput);
    fireEvent.change(titleInput, { target: { value: "已提交ㄓ" } });
    await act(async () => {
      resolveUpdate({
        ...mockItem,
        title: "已提交",
        modified: "2026-01-01T00:01:00.000Z",
      });
    });

    expect(titleInput).toHaveValue("已提交ㄓ");
  });

  it("still persists the latest generation after an earlier title save resolves", async () => {
    const resolvers: Array<(value: Item) => void> = [];
    vi.mocked(api.updateItem).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "第一版" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(api.updateItem).toHaveBeenCalledTimes(1);

    fireEvent.change(titleInput, { target: { value: "最新版" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(api.updateItem).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers[0]({
        ...mockItem,
        title: "第一版",
        modified: "2026-01-01T00:01:00.000Z",
      });
    });

    expect(api.updateItem).toHaveBeenCalledTimes(2);
    expect(api.updateItem).toHaveBeenLastCalledWith("test-1", { title: "最新版" });

    await act(async () => {
      resolvers[1]({
        ...mockItem,
        title: "最新版",
        modified: "2026-01-01T00:02:00.000Z",
      });
    });
  });

  it("serializes a blurred title save behind an in-flight generation", async () => {
    const resolvers: Array<(value: Item) => void> = [];
    vi.mocked(api.updateItem).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "第一版" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(api.updateItem).toHaveBeenCalledTimes(1);

    fireEvent.change(titleInput, { target: { value: "blur 最新版" } });
    fireEvent.blur(titleInput);
    expect(api.updateItem).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers[0]({
        ...mockItem,
        title: "第一版",
        modified: "2026-01-01T00:01:00.000Z",
      });
    });

    expect(api.updateItem).toHaveBeenCalledTimes(2);
    expect(api.updateItem).toHaveBeenLastCalledWith("test-1", { title: "blur 最新版" });

    await act(async () => {
      resolvers[1]({
        ...mockItem,
        title: "blur 最新版",
        modified: "2026-01-01T00:02:00.000Z",
      });
    });
  });

  it("ignores a stale generation failure when the latest title save succeeds", async () => {
    let rejectOld!: (reason: Error) => void;
    let resolveLatest!: (value: Item) => void;
    vi.mocked(api.updateItem)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectOld = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLatest = resolve;
          }),
      );

    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "舊版" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    fireEvent.change(titleInput, { target: { value: "最新版" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(api.updateItem).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectOld(new Error("舊請求逾時"));
    });
    expect(api.updateItem).toHaveBeenCalledTimes(2);
    expect(api.updateItem).toHaveBeenLastCalledWith("test-1", { title: "最新版" });
    expect(screen.getByText("儲存中...")).toBeInTheDocument();

    await act(async () => {
      resolveLatest({
        ...mockItem,
        title: "最新版",
        modified: "2026-01-01T00:02:00.000Z",
      });
    });
    expect(screen.getByText("已儲存")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalledWith("舊請求逾時");
  });

  it("keeps an active IME draft dirty while another field save finishes", async () => {
    let resolveSource!: (value: Item) => void;
    vi.mocked(api.updateItem).mockImplementation((_id, patch) => {
      if ("source" in patch) {
        return new Promise((resolve) => {
          resolveSource = resolve;
        });
      }
      return Promise.resolve({
        ...mockItem,
        title: "組字完成",
        modified: "2026-01-01T00:02:00.000Z",
      });
    });

    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://example.com/pending" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.compositionStart(titleInput);
    fireEvent.change(titleInput, { target: { value: "組字ㄓ" } });
    await act(async () => {
      resolveSource({
        ...mockItem,
        source: "https://example.com/pending",
        modified: "2026-01-01T00:01:00.000Z",
      });
    });

    expect(titleInput).toHaveValue("組字ㄓ");
    expect(screen.queryByText("已儲存")).not.toBeInTheDocument();

    fireEvent.change(titleInput, { target: { value: "組字完成" } });
    fireEvent.compositionEnd(titleInput, { data: "完成" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(api.updateItem).toHaveBeenLastCalledWith("test-1", { title: "組字完成" });
  });

  it("resets IME composition state when switching items", async () => {
    const secondItem = {
      ...mockItem,
      id: "test-2",
      title: "第二個項目",
    };
    vi.mocked(api.getItem).mockImplementation((id) =>
      Promise.resolve(id === secondItem.id ? secondItem : mockItem),
    );

    const { rerender } = renderWithContext(<ItemDetail itemId={mockItem.id} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const firstTitleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(firstTitleInput, { target: { value: "第一個項目已提交" } });
    fireEvent.input(firstTitleInput, {
      target: { value: "第一個項目已提交ㄓ" },
      isComposing: true,
    });
    fireEvent.compositionStart(firstTitleInput);
    rerender(<ItemDetail itemId={secondItem.id} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const secondTitleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(secondTitleInput, { target: { value: "第二個項目已更新" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(api.updateItem).toHaveBeenCalledTimes(2);
    expect(api.updateItem).toHaveBeenCalledWith(mockItem.id, {
      title: "第一個項目已提交",
    });
    expect(api.updateItem).toHaveBeenCalledWith(secondItem.id, {
      title: "第二個項目已更新",
    });
    expect(api.updateItem).not.toHaveBeenCalledWith(mockItem.id, {
      title: "第一個項目已提交ㄓ",
    });
  });

  it("resets save status when switching items during and after a save", async () => {
    const secondItem = {
      ...mockItem,
      id: "test-2",
      title: "第二個項目",
    };
    const resolvers: Array<(value: Item) => void> = [];
    vi.mocked(api.getItem).mockImplementation((id) =>
      Promise.resolve(id === secondItem.id ? secondItem : mockItem),
    );
    vi.mocked(api.updateItem).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const { rerender } = renderWithContext(<ItemDetail itemId={mockItem.id} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.change(screen.getByPlaceholderText("標題"), {
      target: { value: "第一個項目儲存中" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByText("儲存中...")).toBeInTheDocument();

    rerender(<ItemDetail itemId={secondItem.id} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText("儲存中...")).not.toBeInTheDocument();
    expect(screen.queryByText("已儲存")).not.toBeInTheDocument();

    await act(async () => {
      resolvers[0]({
        ...mockItem,
        title: "第一個項目儲存中",
        modified: "2026-01-01T00:01:00.000Z",
      });
    });
    expect(screen.queryByText("儲存中...")).not.toBeInTheDocument();
    expect(screen.queryByText("已儲存")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("標題"), {
      target: { value: "第二個項目已更新" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      resolvers[1]({
        ...secondItem,
        title: "第二個項目已更新",
        modified: "2026-01-01T00:02:00.000Z",
      });
    });
    expect(screen.getByText("已儲存")).toBeInTheDocument();

    rerender(<ItemDetail itemId={mockItem.id} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText("已儲存")).not.toBeInTheDocument();
  });

  it("keeps pending auto-saves scoped to their item when switching", async () => {
    const secondItem = {
      ...mockItem,
      id: "test-2",
      title: "第二個項目",
    };
    vi.mocked(api.getItem).mockImplementation((id) =>
      Promise.resolve(id === secondItem.id ? secondItem : mockItem),
    );

    const { rerender } = renderWithContext(<ItemDetail itemId={mockItem.id} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.change(screen.getByPlaceholderText("標題"), {
      target: { value: "第一個項目已更新" },
    });

    rerender(<ItemDetail itemId={secondItem.id} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.change(screen.getByPlaceholderText("標題"), {
      target: { value: "第二個項目已更新" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(api.updateItem).toHaveBeenCalledTimes(2);
    expect(api.updateItem).toHaveBeenCalledWith(mockItem.id, {
      title: "第一個項目已更新",
    });
    expect(api.updateItem).toHaveBeenCalledWith(secondItem.id, {
      title: "第二個項目已更新",
    });
  });

  it("restores a failed pending edit when returning to an item", async () => {
    const secondItem = {
      ...mockItem,
      id: "test-2",
      title: "第二個項目",
    };
    vi.mocked(api.getItem).mockImplementation((id) =>
      Promise.resolve(id === secondItem.id ? secondItem : mockItem),
    );
    vi.mocked(api.updateItem).mockRejectedValueOnce(new Error("暫時無法儲存"));

    const { rerender } = renderWithContext(<ItemDetail itemId={mockItem.id} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.change(screen.getByPlaceholderText("標題"), {
      target: { value: "尚未儲存的第一個項目" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    rerender(<ItemDetail itemId={secondItem.id} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender(<ItemDetail itemId={mockItem.id} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByPlaceholderText("標題")).toHaveValue("尚未儲存的第一個項目");
  });

  it("retries a failed debounced save when the field blurs", async () => {
    vi.mocked(api.updateItem)
      .mockRejectedValueOnce(new Error("暫時無法儲存"))
      .mockResolvedValueOnce({
        ...mockItem,
        title: "稍後重試",
        modified: "2026-01-01T00:01:00.000Z",
      });

    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "稍後重試" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(api.updateItem).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.blur(titleInput);
    });

    expect(api.updateItem).toHaveBeenCalledTimes(2);
    expect(api.updateItem).toHaveBeenLastCalledWith("test-1", { title: "稍後重試" });
  });

  it("does not let an unrelated immediate save clear a pending title edit", async () => {
    let resolveTitle!: (value: Item) => void;
    let resolveTags!: (value: Item) => void;
    vi.mocked(api.updateItem).mockImplementation((_id, patch) => {
      if ("title" in patch) {
        return new Promise((resolve) => {
          resolveTitle = resolve;
        });
      }
      if ("tags" in patch) {
        return new Promise((resolve) => {
          resolveTags = resolve;
        });
      }
      return Promise.resolve(mockItem);
    });

    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "尚未完成的標題" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    fireEvent.change(screen.getByPlaceholderText("新增標籤..."), {
      target: { value: "review-tag" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新增標籤" }));
    await act(async () => {
      resolveTags({ ...mockItem, tags: '["review-tag"]' });
    });

    expect(titleInput).toHaveValue("尚未完成的標題");

    await act(async () => {
      resolveTitle({
        ...mockItem,
        title: "尚未完成的標題",
        modified: "2026-01-01T00:01:00.000Z",
      });
    });
  });

  it("keeps concurrent title and source auto-saves scoped by field", async () => {
    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.change(screen.getByPlaceholderText("標題"), {
      target: { value: "同時更新標題" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://例え.テスト/同時更新" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(api.updateItem).toHaveBeenCalledTimes(2);
    expect(api.updateItem).toHaveBeenCalledWith(mockItem.id, {
      title: "同時更新標題",
    });
    expect(api.updateItem).toHaveBeenCalledWith(mockItem.id, {
      source: "https://例え.テスト/同時更新",
    });
  });

  it("shows saving until every concurrent field request finishes", async () => {
    let resolveTitle!: (value: Item) => void;
    let resolveSource!: (value: Item) => void;
    vi.mocked(api.updateItem).mockImplementation((_id, patch) => {
      if ("title" in patch) {
        return new Promise((resolve) => {
          resolveTitle = resolve;
        });
      }
      return new Promise((resolve) => {
        resolveSource = resolve;
      });
    });

    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.change(screen.getByPlaceholderText("標題"), {
      target: { value: "並行標題" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://example.com/concurrent" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByText("儲存中...")).toBeInTheDocument();

    await act(async () => {
      resolveTitle({ ...mockItem, title: "並行標題" });
    });
    expect(screen.getByText("儲存中...")).toBeInTheDocument();
    expect(screen.queryByText("已儲存")).not.toBeInTheDocument();

    await act(async () => {
      resolveSource({ ...mockItem, source: "https://example.com/concurrent" });
    });
    expect(screen.getByText("已儲存")).toBeInTheDocument();
  });

  it("does not send a duplicate save when blur occurs during or after a debounced request", async () => {
    let resolveUpdate!: (value: Item) => void;
    vi.mocked(api.updateItem).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "只存一次" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(api.updateItem).toHaveBeenCalledTimes(1);

    fireEvent.blur(titleInput);
    expect(api.updateItem).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveUpdate({
        ...mockItem,
        title: "只存一次",
        modified: "2026-01-01T00:01:00.000Z",
      });
    });
    fireEvent.blur(titleInput);
    expect(api.updateItem).toHaveBeenCalledTimes(1);
  });

  it("cancels scheduled auto-save timers when the editor unmounts", async () => {
    const { unmount } = renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.change(screen.getByPlaceholderText("標題"), {
      target: { value: "不應晚到的儲存" },
    });
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(api.updateItem).not.toHaveBeenCalled();
  });
});

describe("ItemDetail content IME auto-save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setupDefaultMocks();
    vi.mocked(api.updateItem).mockResolvedValue(mockItem);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves only the committed content after IME composition ends", async () => {
    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    const textarea = screen.getByPlaceholderText("Markdown 內容...");
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: "內容ㄓ" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.updateItem).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: "內容中" } });
    fireEvent.compositionEnd(textarea, { data: "中" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(api.updateItem).toHaveBeenCalledWith("test-1", { content: "內容中" });
  });

  it("uses native isComposing as a fallback for content when compositionStart is missed", async () => {
    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    const textarea = screen.getByPlaceholderText("Markdown 內容...");
    fireEvent.input(textarea, {
      target: { value: "內容ㄓ" },
      isComposing: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.updateItem).not.toHaveBeenCalled();

    fireEvent.input(textarea, {
      target: { value: "內容中" },
      isComposing: false,
    });
    fireEvent.compositionEnd(textarea, { data: "中" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(api.updateItem).toHaveBeenCalledWith("test-1", { content: "內容中" });
  });
});

describe("PrivateItemDetail IME auto-save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(privateApi.getPrivateItem).mockResolvedValue(mockPrivateItem);
    vi.mocked(privateApi.getPrivateTags).mockResolvedValue([]);
    vi.mocked(privateApi.updatePrivateItem).mockResolvedValue(mockPrivateItem);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves only the committed private title after IME composition ends", async () => {
    renderWithContext(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.compositionStart(titleInput);
    fireEvent.change(titleInput, { target: { value: "私密ㄓ" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(privateApi.updatePrivateItem).not.toHaveBeenCalled();

    fireEvent.change(titleInput, { target: { value: "私密中" } });
    fireEvent.compositionEnd(titleInput, { data: "中" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(1);
    expect(privateApi.updatePrivateItem).toHaveBeenCalledWith("private-token", mockPrivateItem.id, {
      title: "私密中",
    });
  });

  it("cancels an existing private debounce when IME composition starts", async () => {
    renderWithContext(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "私密已提交" } });
    fireEvent.compositionStart(titleInput);
    fireEvent.change(titleInput, { target: { value: "私密已提交ㄓ" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(privateApi.updatePrivateItem).not.toHaveBeenCalled();

    fireEvent.change(titleInput, { target: { value: "私密已提交中" } });
    fireEvent.compositionEnd(titleInput, { data: "中" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(1);
    expect(privateApi.updatePrivateItem).toHaveBeenCalledWith("private-token", mockPrivateItem.id, {
      title: "私密已提交中",
    });
  });

  it("uses native isComposing as a private fallback without requiring compositionEnd", async () => {
    renderWithContext(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.input(titleInput, {
      target: { value: "私密ㄓ" },
      isComposing: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(privateApi.updatePrivateItem).not.toHaveBeenCalled();

    fireEvent.input(titleInput, {
      target: { value: "私密中" },
      isComposing: false,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(1);
    expect(privateApi.updatePrivateItem).toHaveBeenCalledWith("private-token", mockPrivateItem.id, {
      title: "私密中",
    });
  });

  it("persists the latest private generation after an earlier save resolves", async () => {
    const resolvers: Array<(value: Item) => void> = [];
    vi.mocked(privateApi.updatePrivateItem).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    renderWithContext(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "私密第一版" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(1);

    fireEvent.change(titleInput, { target: { value: "私密最新版" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers[0]({
        ...mockPrivateItem,
        title: "私密第一版",
        modified: "2026-01-01T00:01:00.000Z",
      });
    });

    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(2);
    expect(privateApi.updatePrivateItem).toHaveBeenLastCalledWith(
      "private-token",
      mockPrivateItem.id,
      { title: "私密最新版" },
    );

    await act(async () => {
      resolvers[1]({
        ...mockPrivateItem,
        title: "私密最新版",
        modified: "2026-01-01T00:02:00.000Z",
      });
    });
  });

  it("serializes a blurred private title save behind an in-flight generation", async () => {
    const resolvers: Array<(value: Item) => void> = [];
    vi.mocked(privateApi.updatePrivateItem).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    renderWithContext(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "私密第一版" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(1);

    fireEvent.change(titleInput, { target: { value: "私密 blur 最新版" } });
    fireEvent.blur(titleInput);
    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvers[0]({
        ...mockPrivateItem,
        title: "私密第一版",
        modified: "2026-01-01T00:01:00.000Z",
      });
    });

    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(2);
    expect(privateApi.updatePrivateItem).toHaveBeenLastCalledWith(
      "private-token",
      mockPrivateItem.id,
      { title: "私密 blur 最新版" },
    );

    await act(async () => {
      resolvers[1]({
        ...mockPrivateItem,
        title: "私密 blur 最新版",
        modified: "2026-01-01T00:02:00.000Z",
      });
    });
  });

  it("ignores a stale private generation failure after the latest save succeeds", async () => {
    let rejectOld!: (reason: Error) => void;
    let resolveLatest!: (value: Item) => void;
    vi.mocked(privateApi.updatePrivateItem)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectOld = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLatest = resolve;
          }),
      );

    renderWithContext(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "私密舊版" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    fireEvent.change(titleInput, { target: { value: "私密最新版" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectOld(new Error("私密舊請求逾時"));
    });
    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(2);
    expect(privateApi.updatePrivateItem).toHaveBeenLastCalledWith(
      "private-token",
      mockPrivateItem.id,
      { title: "私密最新版" },
    );
    expect(screen.getByText("儲存中...")).toBeInTheDocument();

    await act(async () => {
      resolveLatest({
        ...mockPrivateItem,
        title: "私密最新版",
        modified: "2026-01-01T00:02:00.000Z",
      });
    });
    expect(screen.getByText("已儲存")).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalledWith("私密舊請求逾時");
  });

  it("keeps a private IME draft dirty while another field save finishes", async () => {
    let resolveSource!: (value: Item) => void;
    vi.mocked(privateApi.updatePrivateItem).mockImplementation((_token, _id, patch) => {
      if ("source" in patch) {
        return new Promise((resolve) => {
          resolveSource = resolve;
        });
      }
      return Promise.resolve({
        ...mockPrivateItem,
        title: "私密組字完成",
        modified: "2026-01-01T00:02:00.000Z",
      });
    });

    renderWithContext(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://example.com/private-pending" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.compositionStart(titleInput);
    fireEvent.change(titleInput, { target: { value: "私密組字ㄓ" } });
    await act(async () => {
      resolveSource({
        ...mockPrivateItem,
        source: "https://example.com/private-pending",
        modified: "2026-01-01T00:01:00.000Z",
      });
    });

    expect(titleInput).toHaveValue("私密組字ㄓ");
    expect(screen.queryByText("已儲存")).not.toBeInTheDocument();

    fireEvent.change(titleInput, { target: { value: "私密組字完成" } });
    fireEvent.compositionEnd(titleInput, { data: "完成" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(privateApi.updatePrivateItem).toHaveBeenLastCalledWith(
      "private-token",
      mockPrivateItem.id,
      { title: "私密組字完成" },
    );
  });

  it("saves only committed private content even when blur occurs during composition", async () => {
    renderWithContext(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "編輯" }));
    const textarea = screen.getByPlaceholderText("Markdown 內容...");
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: "私密內容ㄓ" } });
    fireEvent.blur(textarea);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(privateApi.updatePrivateItem).not.toHaveBeenCalled();

    fireEvent.change(textarea, { target: { value: "私密內容中" } });
    fireEvent.compositionEnd(textarea, { data: "中" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(1);
    expect(privateApi.updatePrivateItem).toHaveBeenCalledWith("private-token", mockPrivateItem.id, {
      content: "私密內容中",
    });
  });

  it("resets private IME composition state when switching items", async () => {
    const secondPrivateItem = {
      ...mockPrivateItem,
      id: "private-test-2",
      title: "第二個私密項目",
    };
    vi.mocked(privateApi.getPrivateItem).mockImplementation((_token, id) =>
      Promise.resolve(id === secondPrivateItem.id ? secondPrivateItem : mockPrivateItem),
    );

    const { rerender } = renderWithContext(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const firstTitleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(firstTitleInput, { target: { value: "第一個私密項目已提交" } });
    fireEvent.input(firstTitleInput, {
      target: { value: "第一個私密項目已提交ㄓ" },
      isComposing: true,
    });
    fireEvent.compositionStart(firstTitleInput);
    rerender(
      <PrivateItemDetail
        token="private-token"
        itemId={secondPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const secondTitleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(secondTitleInput, { target: { value: "第二個私密項目已更新" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(2);
    expect(privateApi.updatePrivateItem).toHaveBeenCalledWith("private-token", mockPrivateItem.id, {
      title: "第一個私密項目已提交",
    });
    expect(privateApi.updatePrivateItem).toHaveBeenCalledWith(
      "private-token",
      secondPrivateItem.id,
      { title: "第二個私密項目已更新" },
    );
    expect(privateApi.updatePrivateItem).not.toHaveBeenCalledWith(
      "private-token",
      mockPrivateItem.id,
      { title: "第一個私密項目已提交ㄓ" },
    );
  });

  it("keeps pending private auto-saves scoped to their item when switching", async () => {
    const secondPrivateItem = {
      ...mockPrivateItem,
      id: "private-test-2",
      title: "第二個私密項目",
    };
    vi.mocked(privateApi.getPrivateItem).mockImplementation((_token, id) =>
      Promise.resolve(id === secondPrivateItem.id ? secondPrivateItem : mockPrivateItem),
    );

    const { rerender } = renderWithContext(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.change(screen.getByPlaceholderText("標題"), {
      target: { value: "第一個私密項目已更新" },
    });

    rerender(
      <PrivateItemDetail
        token="private-token"
        itemId={secondPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.change(screen.getByPlaceholderText("標題"), {
      target: { value: "第二個私密項目已更新" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(2);
    expect(privateApi.updatePrivateItem).toHaveBeenCalledWith("private-token", mockPrivateItem.id, {
      title: "第一個私密項目已更新",
    });
    expect(privateApi.updatePrivateItem).toHaveBeenCalledWith(
      "private-token",
      secondPrivateItem.id,
      { title: "第二個私密項目已更新" },
    );
  });

  it("restores a failed pending private edit when returning to an item", async () => {
    const secondPrivateItem = {
      ...mockPrivateItem,
      id: "private-test-2",
      title: "第二個私密項目",
    };
    vi.mocked(privateApi.getPrivateItem).mockImplementation((_token, id) =>
      Promise.resolve(id === secondPrivateItem.id ? secondPrivateItem : mockPrivateItem),
    );
    vi.mocked(privateApi.updatePrivateItem).mockRejectedValueOnce(new Error("暫時無法儲存"));

    const { rerender } = renderWithContext(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.change(screen.getByPlaceholderText("標題"), {
      target: { value: "尚未儲存的第一個私密項目" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    rerender(
      <PrivateItemDetail
        token="private-token"
        itemId={secondPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByPlaceholderText("標題")).toHaveValue("尚未儲存的第一個私密項目");
  });

  it("saves only the committed private source URL after IME composition ends", async () => {
    renderWithContext(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const sourceInput = screen.getByPlaceholderText("https://...");
    fireEvent.compositionStart(sourceInput);
    fireEvent.change(sourceInput, { target: { value: "https://例え.ㄊ" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(privateApi.updatePrivateItem).not.toHaveBeenCalled();

    fireEvent.change(sourceInput, { target: { value: "https://例え.テスト" } });
    fireEvent.compositionEnd(sourceInput, { data: "テスト" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(1);
    expect(privateApi.updatePrivateItem).toHaveBeenCalledWith("private-token", mockPrivateItem.id, {
      source: "https://例え.テスト",
    });
  });

  it("retries a failed private save without duplicating the in-flight retry", async () => {
    let resolveRetry!: (value: Item) => void;
    vi.mocked(privateApi.updatePrivateItem)
      .mockRejectedValueOnce(new Error("暫時無法儲存"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRetry = resolve;
          }),
      );

    renderWithContext(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "私密稍後重試" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(1);

    fireEvent.blur(titleInput);
    fireEvent.blur(titleInput);
    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveRetry({
        ...mockPrivateItem,
        title: "私密稍後重試",
        modified: "2026-01-01T00:01:00.000Z",
      });
    });
    fireEvent.blur(titleInput);
    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(2);
  });

  it("keeps concurrent private title and source auto-saves scoped by field", async () => {
    renderWithContext(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.change(screen.getByPlaceholderText("標題"), {
      target: { value: "同時更新私密標題" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://例え.テスト/私密同步" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(privateApi.updatePrivateItem).toHaveBeenCalledTimes(2);
    expect(privateApi.updatePrivateItem).toHaveBeenCalledWith("private-token", mockPrivateItem.id, {
      title: "同時更新私密標題",
    });
    expect(privateApi.updatePrivateItem).toHaveBeenCalledWith("private-token", mockPrivateItem.id, {
      source: "https://例え.テスト/私密同步",
    });
  });

  it("keeps the private save indicator busy until all field requests finish", async () => {
    let resolveTitle!: (value: Item) => void;
    let resolveSource!: (value: Item) => void;
    vi.mocked(privateApi.updatePrivateItem).mockImplementation((_token, _id, patch) => {
      if ("title" in patch) {
        return new Promise((resolve) => {
          resolveTitle = resolve;
        });
      }
      return new Promise((resolve) => {
        resolveSource = resolve;
      });
    });

    renderWithContext(
      <PrivateItemDetail
        token="private-token"
        itemId={mockPrivateItem.id}
        onBack={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.change(screen.getByPlaceholderText("標題"), {
      target: { value: "私密並行標題" },
    });
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://example.com/private-concurrent" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.getByText("儲存中...")).toBeInTheDocument();

    await act(async () => {
      resolveTitle({ ...mockPrivateItem, title: "私密並行標題" });
    });
    expect(screen.getByText("儲存中...")).toBeInTheDocument();
    expect(screen.queryByText("已儲存")).not.toBeInTheDocument();

    await act(async () => {
      resolveSource({
        ...mockPrivateItem,
        source: "https://example.com/private-concurrent",
      });
    });
    expect(screen.getByText("已儲存")).toBeInTheDocument();
  });
});

describe("ItemDetail source URL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setupDefaultMocks();
    vi.mocked(api.updateItem).mockResolvedValue({
      ...mockItem,
      modified: "2026-01-01T00:01:00.000Z",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounced save on source URL change", async () => {
    vi.mocked(api.updateItem).mockReturnValue(new Promise(() => {}));
    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const sourceInput = screen.getByPlaceholderText("https://...");
    fireEvent.change(sourceInput, { target: { value: "https://example.com" } });

    expect(api.updateItem).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(api.updateItem).toHaveBeenCalledWith("test-1", { source: "https://example.com" });
  });

  it("saves only the committed source URL after IME composition ends", async () => {
    renderItemDetail();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const sourceInput = screen.getByPlaceholderText("https://...");
    fireEvent.compositionStart(sourceInput);
    fireEvent.change(sourceInput, { target: { value: "https://例え.ㄊ" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(api.updateItem).not.toHaveBeenCalled();

    fireEvent.change(sourceInput, { target: { value: "https://例え.テスト" } });
    fireEvent.compositionEnd(sourceInput, { data: "テスト" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(api.updateItem).toHaveBeenCalledWith("test-1", {
      source: "https://例え.テスト",
    });
  });
});

describe("ItemDetail alias management", () => {
  beforeEach(() => {
    setupDefaultMocks(mockItemWithAliases);
    vi.mocked(api.updateItem).mockResolvedValue({
      ...mockItemWithAliases,
      modified: "2026-01-01T00:01:00.000Z",
    });
  });

  it("adds alias on Enter key", async () => {
    const user = userEvent.setup();
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("alias-one")).toBeInTheDocument();
    });

    const aliasInput = screen.getByPlaceholderText("新增別名...");
    await user.type(aliasInput, "new-alias{Enter}");

    await waitFor(() => {
      expect(api.updateItem).toHaveBeenCalledWith("test-1", {
        aliases: ["alias-one", "alias-two", "new-alias"],
      });
    });
  });

  it("removes alias on X click", async () => {
    const user = userEvent.setup();
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("alias-one")).toBeInTheDocument();
    });

    // Find the X button within the alias-one badge
    const aliasBadge = screen.getByText("alias-one").closest(".gap-1")!;
    const removeBtn = aliasBadge.querySelector("button")!;
    await user.click(removeBtn);

    await waitFor(() => {
      expect(api.updateItem).toHaveBeenCalledWith("test-1", {
        aliases: ["alias-two"],
      });
    });
  });
});

describe("ItemDetail type-specific rendering", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows due date field only for todo", async () => {
    setupDefaultMocks(mockTodoItem);
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("到期日")).toBeInTheDocument();
    });
  });

  it("does not show due date field for note", async () => {
    setupDefaultMocks();
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("標題")).toBeInTheDocument();
    });
    expect(screen.queryByText("到期日")).not.toBeInTheDocument();
  });

  it("shows GTD quick tags for todo", async () => {
    setupDefaultMocks(mockTodoItem);
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("下一步")).toBeInTheDocument();
    });
    expect(screen.getByText("等待中")).toBeInTheDocument();
    expect(screen.getByText("有一天")).toBeInTheDocument();
  });

  it("does not show GTD quick tags for note", async () => {
    setupDefaultMocks();
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("標題")).toBeInTheDocument();
    });
    expect(screen.queryByText("下一步")).not.toBeInTheDocument();
    expect(screen.queryByText("等待中")).not.toBeInTheDocument();
  });

  it("hides tags and aliases sections for scratch", async () => {
    setupDefaultMocks(mockScratchItem);
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("標題")).toBeInTheDocument();
    });
    // "標籤" label should not exist for scratch
    expect(screen.queryByText("標籤")).not.toBeInTheDocument();
    // "別名" label should not exist for scratch
    expect(screen.queryByText("別名")).not.toBeInTheDocument();
  });

  it("shows share button only for note type", async () => {
    setupDefaultMocks();
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("分享")).toBeInTheDocument();
    });
  });

  it("does not show share button for todo type", async () => {
    setupDefaultMocks(mockTodoItem);
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("標題")).toBeInTheDocument();
    });
    expect(screen.queryByText("分享")).not.toBeInTheDocument();
  });
});

describe("ItemDetail delete", () => {
  beforeEach(() => {
    setupDefaultMocks();
    vi.mocked(api.deleteItem).mockResolvedValue(undefined);
  });

  it("delete flow calls onDeleted callback", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    renderItemDetail({}, { onDeleted });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("標題")).toBeInTheDocument();
    });

    // Find the button containing the trash icon (destructive text)
    const allButtons = screen.getAllByRole("button");
    const deleteButton = allButtons.find((btn) => btn.querySelector(".text-destructive") !== null)!;
    await user.click(deleteButton);

    // Confirm in dialog
    await waitFor(() => {
      expect(screen.getByText("確認刪除")).toBeInTheDocument();
    });

    const confirmBtn = screen.getByRole("button", { name: "刪除" });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(api.deleteItem).toHaveBeenCalledWith("test-1");
    });
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
  });
});

describe("ItemDetail export", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows export button for permanent note with obsidian enabled", async () => {
    setupDefaultMocks(mockPermanentNote);
    renderItemDetail({ obsidianEnabled: true });

    await waitFor(() => {
      expect(screen.getByText("匯出到 Obsidian")).toBeInTheDocument();
    });
  });

  it("hides export button when note is not permanent", async () => {
    setupDefaultMocks(); // fleeting note
    renderItemDetail({ obsidianEnabled: true });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("標題")).toBeInTheDocument();
    });
    expect(screen.queryByText("匯出到 Obsidian")).not.toBeInTheDocument();
  });

  it("hides export button when obsidian is disabled", async () => {
    setupDefaultMocks(mockPermanentNote);
    renderItemDetail({ obsidianEnabled: false });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("標題")).toBeInTheDocument();
    });
    expect(screen.queryByText("匯出到 Obsidian")).not.toBeInTheDocument();
  });

  it("calls exportItem and updates status on success", async () => {
    const user = userEvent.setup();
    setupDefaultMocks(mockPermanentNote);
    vi.mocked(api.exportItem).mockResolvedValue({ path: "/vault/test.md" });
    vi.mocked(api.getItem)
      .mockResolvedValueOnce(mockPermanentNote)
      .mockResolvedValueOnce({
        ...mockPermanentNote,
        status: "exported",
      });

    renderItemDetail({ obsidianEnabled: true });

    await waitFor(() => {
      expect(screen.getByText("匯出到 Obsidian")).toBeInTheDocument();
    });

    await user.click(screen.getByText("匯出到 Obsidian"));

    await waitFor(() => {
      expect(api.exportItem).toHaveBeenCalledWith("test-1");
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("已匯出到 Obsidian: /vault/test.md");
    });
  });
});

describe("ItemDetail offline behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("suppresses auto-save and shows toast when offline", async () => {
    renderItemDetail({ isOnline: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Clear any calls from initial load
    vi.mocked(api.updateItem).mockClear();
    vi.mocked(toast.error).mockClear();

    const titleInput = screen.getByPlaceholderText("標題");
    fireEvent.change(titleInput, { target: { value: "New Title" } });

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    // Flush microtasks for the async saveField
    await act(async () => {});

    expect(api.updateItem).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("離線中，無法儲存變更");
  });

  it("disables delete button when offline", async () => {
    renderItemDetail({ isOnline: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Find the delete button (has Trash2 icon with text-destructive class)
    const buttons = screen.getAllByRole("button");
    const deleteBtn = buttons.find(
      (btn) => btn.querySelector("svg.text-destructive") || btn.querySelector(".text-destructive"),
    );
    expect(deleteBtn).toBeDisabled();
  });

  it("disables header action buttons when offline", async () => {
    renderItemDetail({ isOnline: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Share button should be disabled
    const shareBtn = screen.getByRole("button", { name: /分享/ });
    expect(shareBtn).toBeDisabled();

    // Create todo button should be disabled
    const todoBtn = screen.getByRole("button", { name: /建立追蹤待辦/ });
    expect(todoBtn).toBeDisabled();
  });

  it("disables export button when offline", async () => {
    setupDefaultMocks(mockPermanentNote);
    renderItemDetail({ isOnline: false, obsidianEnabled: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const exportBtn = screen.getByRole("button", { name: /匯出到 Obsidian/ });
    expect(exportBtn).toBeDisabled();
  });

  it("shows offline warning in content editor after switching to edit mode", async () => {
    renderItemDetail({ isOnline: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Default is preview mode — warning hidden
    expect(screen.queryByText("離線中 — 編輯內容將不會自動儲存")).not.toBeInTheDocument();

    // Switch to edit mode
    await act(async () => {
      fireEvent.click(screen.getByText("編輯"));
    });
    expect(screen.getByText("離線中 — 編輯內容將不會自動儲存")).toBeInTheDocument();
  });
});

describe("ItemDetail category", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Polyfills for Radix Select in jsdom
    window.HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    window.HTMLElement.prototype.setPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    // @ts-expect-error ResizeObserver mock
    window.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders category section for note", async () => {
    setupDefaultMocks({
      ...mockItem,
      category_id: "cat-1",
      category_name: "工作",
    });
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("分類")).toBeInTheDocument();
    });
  });

  it("does not render category section for scratch", async () => {
    setupDefaultMocks(mockScratchItem);
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("標題")).toBeInTheDocument();
    });
    expect(screen.queryByText("分類")).not.toBeInTheDocument();
  });

  it("updates local state immediately when selecting a category", async () => {
    const user = userEvent.setup();

    // Setup with one category available
    vi.mocked(api.getItem).mockResolvedValue(mockItem);
    vi.mocked(api.getTags).mockResolvedValue({ tags: [] });
    vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(api.listCategories).mockResolvedValue({
      categories: [
        {
          id: "cat-1",
          name: "工作",
          sort_order: 0,
          color: "#ff0000",
          created: "2026-01-01T00:00:00.000Z",
          modified: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(api.updateItem).mockResolvedValue({
      ...mockItem,
      category_id: "cat-1",
      category_name: "工作",
      modified: "2026-01-01T00:01:00.000Z",
    });

    renderItemDetail();

    // Wait for categories to load
    await waitFor(() => {
      expect(screen.getByText("分類")).toBeInTheDocument();
    });

    // Find the category combobox (shows "未分類")
    const allComboboxes = screen.getAllByRole("combobox");
    const categoryTrigger = allComboboxes.find((cb) => cb.textContent?.includes("未分類"));
    expect(categoryTrigger).toBeDefined();

    // Open dropdown and select "工作"
    await user.click(categoryTrigger!);
    const option = await screen.findByRole("option", { name: /工作/ });
    await user.click(option);

    // Verify updateItem was called with the selected category
    await waitFor(() => {
      expect(api.updateItem).toHaveBeenCalledWith("test-1", { category_id: "cat-1" });
    });

    // Key assertion: after save, CategorySelect should still show "工作"
    // Without the fix, local state doesn't update category_id so it reverts to "未分類"
    await waitFor(() => {
      expect(categoryTrigger).toHaveTextContent("工作");
    });
  });
});
