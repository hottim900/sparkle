import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithContext } from "@/test-utils";
import { ShareManagement } from "../share-management";
import type { ShareToken } from "@/lib/types";

const mockListShares = vi.fn();
const mockRevokeShare = vi.fn();

vi.mock("@/lib/api", () => ({
  listShares: (...args: unknown[]) => mockListShares(...args),
  revokeShare: (...args: unknown[]) => mockRevokeShare(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeShare(overrides: Partial<ShareToken> = {}): ShareToken {
  return {
    id: "share-1",
    item_id: "item-1",
    token: "abc123",
    visibility: "unlisted",
    created: "2026-01-15T00:00:00Z",
    item_title: "My Shared Note",
    ...overrides,
  };
}

describe("ShareManagement", () => {
  const onNavigateToItem = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading spinner initially", () => {
    mockListShares.mockReturnValue(new Promise(() => {}));
    renderWithContext(<ShareManagement onNavigateToItem={onNavigateToItem} />);

    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("renders page title", async () => {
    mockListShares.mockResolvedValue({ shares: [] });
    renderWithContext(<ShareManagement onNavigateToItem={onNavigateToItem} />);

    await waitFor(() => {
      expect(screen.getByText("分享管理")).toBeInTheDocument();
    });
  });

  it("shows share count badge", async () => {
    mockListShares.mockResolvedValue({
      shares: [makeShare({ id: "s1" }), makeShare({ id: "s2" })],
    });
    renderWithContext(<ShareManagement onNavigateToItem={onNavigateToItem} />);

    await waitFor(() => {
      expect(screen.getByText("2 個分享")).toBeInTheDocument();
    });
  });

  it("renders shares with visibility badges", async () => {
    mockListShares.mockResolvedValue({
      shares: [
        makeShare({ id: "s1", visibility: "public", item_title: "Public Note" }),
        makeShare({ id: "s2", visibility: "unlisted", item_title: "Private Note" }),
      ],
    });
    renderWithContext(<ShareManagement onNavigateToItem={onNavigateToItem} />);

    await waitFor(() => {
      expect(screen.getByText("Public Note")).toBeInTheDocument();
    });
    expect(screen.getByText("Private Note")).toBeInTheDocument();
    expect(screen.getByText("公開")).toBeInTheDocument();
    expect(screen.getByText("僅限連結")).toBeInTheDocument();
  });

  it("renders created date in zh-TW locale", async () => {
    mockListShares.mockResolvedValue({
      shares: [makeShare({ created: "2026-01-15T00:00:00Z" })],
    });
    renderWithContext(<ShareManagement onNavigateToItem={onNavigateToItem} />);

    await waitFor(() => {
      expect(
        screen.getByText(new Date("2026-01-15T00:00:00Z").toLocaleDateString("zh-TW")),
      ).toBeInTheDocument();
    });
  });

  it("shows empty state when no shares", async () => {
    mockListShares.mockResolvedValue({ shares: [] });
    renderWithContext(<ShareManagement onNavigateToItem={onNavigateToItem} />);

    await waitFor(() => {
      expect(screen.getByText("尚無分享的筆記")).toBeInTheDocument();
    });
  });

  it("copies share link to clipboard", async () => {
    const { toast } = await import("sonner");
    mockListShares.mockResolvedValue({ shares: [makeShare({ token: "test-token" })] });

    const user = userEvent.setup();
    renderWithContext(<ShareManagement onNavigateToItem={onNavigateToItem} />);

    await waitFor(() => {
      expect(screen.getByText("My Shared Note")).toBeInTheDocument();
    });

    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    await user.click(screen.getByTitle("複製連結"));

    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining("/s/test-token"));
    });
    expect(toast.success).toHaveBeenCalledWith("已複製連結");

    writeTextSpy.mockRestore();
  });

  it("revokes share after confirmation dialog", async () => {
    const { toast } = await import("sonner");
    mockListShares.mockResolvedValue({
      shares: [makeShare({ id: "s1", item_title: "Shared Note" })],
    });
    mockRevokeShare.mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderWithContext(<ShareManagement onNavigateToItem={onNavigateToItem} />);

    await waitFor(() => {
      expect(screen.getByText("Shared Note")).toBeInTheDocument();
    });

    // Click revoke button opens confirmation dialog
    await user.click(screen.getByTitle("撤銷分享"));
    expect(screen.getByText("確認撤銷分享")).toBeInTheDocument();
    expect(screen.getByText(/確定要撤銷「Shared Note」的分享連結嗎/)).toBeInTheDocument();

    // Confirm revoke
    await user.click(screen.getByRole("button", { name: "撤銷" }));

    await waitFor(() => {
      expect(mockRevokeShare).toHaveBeenCalledWith("s1");
    });
    expect(toast.success).toHaveBeenCalledWith("已撤銷分享");

    await waitFor(() => {
      expect(screen.queryByText("Shared Note")).not.toBeInTheDocument();
    });
  });

  it("cancels revoke when cancel button is clicked", async () => {
    mockListShares.mockResolvedValue({
      shares: [makeShare({ id: "s1", item_title: "Shared Note" })],
    });

    const user = userEvent.setup();
    renderWithContext(<ShareManagement onNavigateToItem={onNavigateToItem} />);

    await waitFor(() => {
      expect(screen.getByText("Shared Note")).toBeInTheDocument();
    });

    // Click revoke button opens dialog
    await user.click(screen.getByTitle("撤銷分享"));
    expect(screen.getByText("確認撤銷分享")).toBeInTheDocument();

    // Click cancel
    await user.click(screen.getByRole("button", { name: "取消" }));

    // Dialog closed, API not called
    expect(mockRevokeShare).not.toHaveBeenCalled();
    expect(screen.getByText("Shared Note")).toBeInTheDocument();
  });

  it("shows error toast on revoke failure", async () => {
    const { toast } = await import("sonner");
    mockListShares.mockResolvedValue({ shares: [makeShare()] });
    mockRevokeShare.mockRejectedValue(new Error("Server error"));

    const user = userEvent.setup();
    renderWithContext(<ShareManagement onNavigateToItem={onNavigateToItem} />);

    await waitFor(() => {
      expect(screen.getByText("My Shared Note")).toBeInTheDocument();
    });

    // Open dialog and confirm
    await user.click(screen.getByTitle("撤銷分享"));
    await user.click(screen.getByRole("button", { name: "撤銷" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Server error");
    });
  });

  it("navigates to source note when title is clicked", async () => {
    mockListShares.mockResolvedValue({
      shares: [makeShare({ item_id: "note-42", item_title: "Click Me" })],
    });

    const user = userEvent.setup();
    renderWithContext(<ShareManagement onNavigateToItem={onNavigateToItem} />);

    await waitFor(() => {
      expect(screen.getByText("Click Me")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Click Me"));
    expect(onNavigateToItem).toHaveBeenCalledWith("note-42");
  });

  it("navigate button has accessible aria-label", async () => {
    mockListShares.mockResolvedValue({
      shares: [makeShare({ item_title: "Accessible Note" })],
    });
    renderWithContext(<ShareManagement onNavigateToItem={onNavigateToItem} />);

    await waitFor(() => {
      expect(screen.getByLabelText("前往筆記：Accessible Note")).toBeInTheDocument();
    });
  });

  it("shows error toast on load failure", async () => {
    const { toast } = await import("sonner");
    mockListShares.mockRejectedValue(new Error("Network error"));
    renderWithContext(<ShareManagement onNavigateToItem={onNavigateToItem} />);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("無法載入分享資料");
    });
  });

  describe("offline behavior", () => {
    let originalOnLine: boolean;

    beforeEach(() => {
      originalOnLine = navigator.onLine;
      Object.defineProperty(navigator, "onLine", {
        value: false,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(navigator, "onLine", {
        value: originalOnLine,
        writable: true,
        configurable: true,
      });
    });

    it("disables revoke button when offline", async () => {
      mockListShares.mockResolvedValue({ shares: [makeShare()] });
      renderWithContext(<ShareManagement onNavigateToItem={onNavigateToItem} />, {
        isOnline: false,
      });

      await waitFor(() => {
        expect(screen.getByText("My Shared Note")).toBeInTheDocument();
      });

      expect(screen.getByTitle("撤銷分享")).toBeDisabled();
    });

    it("keeps copy button enabled when offline", async () => {
      mockListShares.mockResolvedValue({ shares: [makeShare()] });
      renderWithContext(<ShareManagement onNavigateToItem={onNavigateToItem} />, {
        isOnline: false,
      });

      await waitFor(() => {
        expect(screen.getByText("My Shared Note")).toBeInTheDocument();
      });

      expect(screen.getByTitle("複製連結")).not.toBeDisabled();
    });
  });
});
