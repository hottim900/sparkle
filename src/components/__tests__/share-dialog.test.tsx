import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShareDialog } from "../share-dialog";
import { toast } from "sonner";
import type { ShareToken } from "@/lib/types";

const mockGetItemShares = vi.fn();
const mockCreateShare = vi.fn();
const mockRevokeShare = vi.fn();

vi.mock("@/lib/api", () => ({
  getItemShares: (...args: unknown[]) => mockGetItemShares(...args),
  createShare: (...args: unknown[]) => mockCreateShare(...args),
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
    ...overrides,
  };
}

const defaultProps = {
  itemId: "item-1",
  itemTitle: "Test Note",
  open: true,
  onOpenChange: vi.fn(),
};

describe("ShareDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard API for jsdom
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
  });

  it("shows loading spinner while loading shares", () => {
    mockGetItemShares.mockReturnValue(new Promise(() => {}));
    render(<ShareDialog {...defaultProps} />);

    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("loads existing shares on open", async () => {
    const share = makeShare();
    mockGetItemShares.mockResolvedValue({ shares: [share] });

    render(<ShareDialog {...defaultProps} />);

    await waitFor(() => {
      expect(mockGetItemShares).toHaveBeenCalledWith("item-1");
    });
    expect(screen.getByText("目前分享")).toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it("displays public share with correct badge", async () => {
    mockGetItemShares.mockResolvedValue({
      shares: [makeShare({ visibility: "public" })],
    });

    render(<ShareDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("公開")).toBeInTheDocument();
    });
  });

  it("creates new share and shows success toast", async () => {
    mockGetItemShares.mockResolvedValue({ shares: [] });
    mockCreateShare.mockResolvedValue({
      share: makeShare({ id: "share-new", token: "newtoken" }),
      url: "/s/newtoken",
    });

    const user = userEvent.setup();
    render(<ShareDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("建立分享")).toBeInTheDocument();
    });

    await user.click(screen.getByText("建立分享"));

    await waitFor(() => {
      expect(mockCreateShare).toHaveBeenCalledWith("item-1", "unlisted");
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("已建立分享並複製連結");
    });
    // New share appears in list
    expect(screen.getByText(/newtoken/)).toBeInTheDocument();
  });

  it("copies existing share link with toast confirmation", async () => {
    mockGetItemShares.mockResolvedValue({ shares: [makeShare()] });

    const user = userEvent.setup();
    render(<ShareDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTitle("複製連結")).toBeInTheDocument();
    });

    await user.click(screen.getByTitle("複製連結"));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("已複製連結");
    });
  });

  it("revokes share", async () => {
    mockGetItemShares.mockResolvedValue({ shares: [makeShare()] });
    mockRevokeShare.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<ShareDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTitle("撤銷分享")).toBeInTheDocument();
    });

    await user.click(screen.getByTitle("撤銷分享"));

    await waitFor(() => {
      expect(mockRevokeShare).toHaveBeenCalledWith("share-1");
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("已撤銷分享");
    });
    // Share removed from list
    expect(screen.queryByText(/abc123/)).not.toBeInTheDocument();
  });

  it("shows error toast on create failure", async () => {
    mockGetItemShares.mockResolvedValue({ shares: [] });
    mockCreateShare.mockRejectedValue(new Error("Server error"));

    const user = userEvent.setup();
    render(<ShareDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("建立分享")).toBeInTheDocument();
    });

    await user.click(screen.getByText("建立分享"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Server error");
    });
  });

  it("shows visibility description text", async () => {
    mockGetItemShares.mockResolvedValue({ shares: [] });

    render(<ShareDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("僅知道連結的人可以查看")).toBeInTheDocument();
    });
  });

  it("does not load shares when dialog is closed", () => {
    mockGetItemShares.mockResolvedValue({ shares: [] });
    render(<ShareDialog {...defaultProps} open={false} />);

    expect(mockGetItemShares).not.toHaveBeenCalled();
  });

  it("disables create share button when offline", async () => {
    mockGetItemShares.mockResolvedValue({ shares: [] });
    render(<ShareDialog {...defaultProps} isOnline={false} />);

    await waitFor(() => {
      expect(screen.getByText("建立分享")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /建立分享/ })).toBeDisabled();
  });

  it("disables revoke button when offline", async () => {
    mockGetItemShares.mockResolvedValue({ shares: [makeShare()] });
    render(<ShareDialog {...defaultProps} isOnline={false} />);

    await waitFor(() => {
      expect(screen.getByTitle("撤銷分享")).toBeInTheDocument();
    });

    expect(screen.getByTitle("撤銷分享")).toBeDisabled();
  });
});
