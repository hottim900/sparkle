import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  Outlet,
} from "@tanstack/react-router";
import { RenameReferencesDialog } from "../rename-references-dialog";
import type { SweptReferences } from "@/lib/api";

function renderWithRouter(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => ui,
  });
  const itemRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/item/$id",
    component: () => <div>item</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, itemRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const mockUndoRename = vi.fn();

vi.mock("@/lib/api", () => ({
  undoRename: (...args: unknown[]) => mockUndoRename(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeSwept(overrides: Partial<SweptReferences> = {}): SweptReferences {
  return {
    rewritten_count: 3,
    rewritten_source_ids: ["s1", "s2", "s3"],
    rewritten_sources: [
      { id: "s1", title: "Source One" },
      { id: "s2", title: "Source Two" },
      { id: "s3", title: "Source Three" },
    ],
    skipped_share_token_source_ids: [],
    history_id: "hist-123",
    ...overrides,
  };
}

describe("RenameReferencesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the rename summary line with old → new", async () => {
    renderWithRouter(
      <RenameReferencesDialog
        open={true}
        onOpenChange={vi.fn()}
        oldTitle="Hub"
        newTitle="Centre"
        swept={makeSwept()}
      />,
    );
    await waitFor(() => expect(screen.getByText("標題已重新命名")).toBeInTheDocument());
    expect(screen.getByText("Hub")).toBeInTheDocument();
    expect(screen.getByText("Centre")).toBeInTheDocument();
    // Sparkle/Obsidian scope copy lives in a single <span>; matcher selects
    // the leaf node directly (parent ancestors would also match if we used
    // getByText with a function predicate, raising "found multiple").
    expect(screen.getByText(/Obsidian 的 rename 功能才是處理 vault 的方式/)).toBeInTheDocument();
  });

  it("inline mode (N ≤ 20): lists every source title with link", async () => {
    renderWithRouter(
      <RenameReferencesDialog
        open={true}
        onOpenChange={vi.fn()}
        oldTitle="Hub"
        newTitle="Centre"
        swept={makeSwept()}
      />,
    );
    await waitFor(() => expect(screen.getByText("Source One")).toBeInTheDocument());
    expect(screen.getByText("Source Two")).toBeInTheDocument();
    expect(screen.getByText("Source Three")).toBeInTheDocument();
    expect(screen.getByText(/已更新的來源/)).toBeInTheDocument();
    // No "前 5 筆" preview heading
    expect(screen.queryByText(/前 5 筆來源/)).not.toBeInTheDocument();
  });

  it("summary mode (N > 20): shows first 5 + 'still X more' notice", async () => {
    const swept = makeSwept({
      rewritten_count: 30,
      rewritten_source_ids: Array.from({ length: 30 }, (_, i) => `s${i}`),
      rewritten_sources: Array.from({ length: 30 }, (_, i) => ({
        id: `s${i}`,
        title: `Source ${i}`,
      })),
    });
    renderWithRouter(
      <RenameReferencesDialog
        open={true}
        onOpenChange={vi.fn()}
        oldTitle="Hub"
        newTitle="Centre"
        swept={swept}
      />,
    );
    await waitFor(() => expect(screen.getByText("Source 0")).toBeInTheDocument());
    expect(screen.getByText("Source 4")).toBeInTheDocument();
    // 6th not visible
    expect(screen.queryByText("Source 5")).not.toBeInTheDocument();
    // Remaining count
    expect(screen.getByText(/還有 25 筆未顯示/)).toBeInTheDocument();
    expect(screen.getByText(/前 5 筆來源/)).toBeInTheDocument();
  });

  it("renders skipped-share-token warning when present", async () => {
    const swept = makeSwept({
      skipped_share_token_source_ids: ["shared-1", "shared-2"],
    });
    renderWithRouter(
      <RenameReferencesDialog
        open={true}
        onOpenChange={vi.fn()}
        oldTitle="PrivateHub"
        newTitle="PrivateHub2"
        swept={swept}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/2 個來源未更新.*share-token 防洩漏/)).toBeInTheDocument(),
    );
  });

  it("hides warning when no skipped sources", async () => {
    renderWithRouter(
      <RenameReferencesDialog
        open={true}
        onOpenChange={vi.fn()}
        oldTitle="Hub"
        newTitle="Centre"
        swept={makeSwept()}
      />,
    );
    // Wait for any dialog content to mount, then assert warning absent.
    await waitFor(() => expect(screen.getByText("標題已重新命名")).toBeInTheDocument());
    expect(screen.queryByText(/share-token 防洩漏/)).not.toBeInTheDocument();
  });

  it("undo button is a two-step confirm and calls undoRename on confirm", async () => {
    mockUndoRename.mockResolvedValue({ rewrittenCount: 3, rewrittenSourceIds: ["s1", "s2", "s3"] });
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithRouter(
      <RenameReferencesDialog
        open={true}
        onOpenChange={onOpenChange}
        oldTitle="Hub"
        newTitle="Centre"
        swept={makeSwept()}
      />,
    );

    const undoBtn = await screen.findByRole("button", { name: /還原此 rename/ });
    await user.click(undoBtn);
    // Confirm button now visible
    const confirmBtn = await screen.findByRole("button", { name: /確認還原/ });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockUndoRename).toHaveBeenCalledWith("hist-123");
    });
    // Dialog closes on success
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("undo cancel returns to initial state without firing the mutation", async () => {
    const user = userEvent.setup();
    renderWithRouter(
      <RenameReferencesDialog
        open={true}
        onOpenChange={vi.fn()}
        oldTitle="Hub"
        newTitle="Centre"
        swept={makeSwept()}
      />,
    );
    const undoBtn = await screen.findByRole("button", { name: /還原此 rename/ });
    await user.click(undoBtn);
    await user.click(screen.getByRole("button", { name: /^取消$/ }));
    // Back to initial state — single undo button + close
    expect(screen.getByRole("button", { name: /還原此 rename/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /確認還原/ })).not.toBeInTheDocument();
    expect(mockUndoRename).not.toHaveBeenCalled();
  });

  it("hides undo button when history_id is null (no-op rename)", async () => {
    const swept = makeSwept({ history_id: null });
    renderWithRouter(
      <RenameReferencesDialog
        open={true}
        onOpenChange={vi.fn()}
        oldTitle="Hub"
        newTitle="Centre"
        swept={swept}
      />,
    );
    await waitFor(() => expect(screen.getByText("標題已重新命名")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /還原此 rename/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^關閉$/ })).toBeInTheDocument();
  });

  it("renders (未命名) placeholder for empty source titles", async () => {
    const swept = makeSwept({
      rewritten_sources: [{ id: "s1", title: "" }],
    });
    renderWithRouter(
      <RenameReferencesDialog
        open={true}
        onOpenChange={vi.fn()}
        oldTitle="Hub"
        newTitle="Centre"
        swept={swept}
      />,
    );
    await waitFor(() => expect(screen.getByText("(未命名)")).toBeInTheDocument());
  });
});
