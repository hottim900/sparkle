import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "../settings";
import type { SettingsResponse, ShareToken } from "@/lib/types";

const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockExportData = vi.fn();
const mockImportData = vi.fn();
const mockListShares = vi.fn();
const mockRevokeShare = vi.fn();

vi.mock("@/lib/api", () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
  exportData: (...args: unknown[]) => mockExportData(...args),
  importData: (...args: unknown[]) => mockImportData(...args),
  listShares: (...args: unknown[]) => mockListShares(...args),
  revokeShare: (...args: unknown[]) => mockRevokeShare(...args),
}));

let mockTheme = "light";
const mockSetTheme = vi.fn();

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: mockTheme, setTheme: mockSetTheme }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeSettings(overrides: Partial<SettingsResponse> = {}): SettingsResponse {
  return {
    obsidian_enabled: "false",
    obsidian_vault_path: "/home/user/vault",
    obsidian_inbox_folder: "0_Inbox",
    obsidian_export_mode: "overwrite",
    ...overrides,
  };
}

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

function setupDefaults(settingsOverrides?: Partial<SettingsResponse>, shares?: ShareToken[]) {
  mockGetSettings.mockResolvedValue(makeSettings(settingsOverrides));
  mockListShares.mockResolvedValue({ shares: shares ?? [] });
}

describe("Settings", () => {
  const onSettingsChanged = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockTheme = "light";
  });

  it("shows loading spinner initially", () => {
    mockGetSettings.mockReturnValue(new Promise(() => {}));
    mockListShares.mockReturnValue(new Promise(() => {}));

    render(<Settings onSettingsChanged={onSettingsChanged} />);
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("renders settings after loading", async () => {
    setupDefaults();
    render(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("設定")).toBeInTheDocument();
    });
    expect(screen.getByText("Obsidian 匯出")).toBeInTheDocument();
  });

  it("toggles obsidian enabled/disabled", async () => {
    setupDefaults();
    const user = userEvent.setup();
    render(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("已停用")).toBeInTheDocument();
    });

    await user.click(screen.getByText("已停用"));
    expect(screen.getByText("已啟用")).toBeInTheDocument();
  });

  it("vault path input is disabled when obsidian is off", async () => {
    setupDefaults({ obsidian_enabled: "false" });
    render(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("設定")).toBeInTheDocument();
    });

    const vaultInput = screen.getByPlaceholderText("/home/user/obsidian-vault");
    expect(vaultInput).toBeDisabled();
  });

  it("save calls API and shows toast", async () => {
    const { toast } = await import("sonner");
    const updatedSettings = makeSettings({ obsidian_enabled: "true" });
    setupDefaults();
    mockUpdateSettings.mockResolvedValue(updatedSettings);

    const user = userEvent.setup();
    render(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("已停用")).toBeInTheDocument();
    });

    // Toggle enable → makes hasChanges = true
    await user.click(screen.getByText("已停用"));

    // Click save
    await user.click(screen.getByText("儲存設定"));

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ obsidian_enabled: "true" }),
      );
    });
    expect(toast.success).toHaveBeenCalledWith("設定已儲存");
    expect(onSettingsChanged).toHaveBeenCalled();
  });

  it("save failure shows error toast", async () => {
    const { toast } = await import("sonner");
    setupDefaults();
    mockUpdateSettings.mockRejectedValue(new Error("Server error"));

    const user = userEvent.setup();
    render(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("已停用")).toBeInTheDocument();
    });

    await user.click(screen.getByText("已停用"));
    await user.click(screen.getByText("儲存設定"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Server error");
    });
  });

  it("renders shares with visibility badges", async () => {
    setupDefaults({}, [
      makeShare({ id: "s1", visibility: "public", item_title: "Public Note" }),
      makeShare({ id: "s2", visibility: "unlisted", item_title: "Private Note" }),
    ]);
    render(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("Public Note")).toBeInTheDocument();
    });
    expect(screen.getByText("Private Note")).toBeInTheDocument();
    expect(screen.getByText("公開")).toBeInTheDocument();
    expect(screen.getByText("僅限連結")).toBeInTheDocument();
  });

  it("revoke share removes it from list", async () => {
    const { toast } = await import("sonner");
    const share = makeShare({ id: "s1", item_title: "Shared Note" });
    setupDefaults({}, [share]);
    mockRevokeShare.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("Shared Note")).toBeInTheDocument();
    });

    await user.click(screen.getByTitle("撤銷分享"));

    await waitFor(() => {
      expect(mockRevokeShare).toHaveBeenCalledWith("s1");
    });
    expect(toast.success).toHaveBeenCalledWith("已撤銷分享");

    await waitFor(() => {
      expect(screen.queryByText("Shared Note")).not.toBeInTheDocument();
    });
  });

  it("copy share link writes to clipboard", async () => {
    const { toast } = await import("sonner");
    setupDefaults({}, [makeShare({ token: "test-token" })]);

    const user = userEvent.setup();
    render(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("My Shared Note")).toBeInTheDocument();
    });

    // Mock clipboard.writeText on the actual navigator.clipboard used at runtime
    const writeTextSpy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    await user.click(screen.getByTitle("複製連結"));

    await waitFor(() => {
      expect(writeTextSpy).toHaveBeenCalledWith(expect.stringContaining("/s/test-token"));
    });
    expect(toast.success).toHaveBeenCalledWith("已複製連結");

    writeTextSpy.mockRestore();
  });

  it("export data calls API and shows toast", async () => {
    const { toast } = await import("sonner");
    setupDefaults();
    mockExportData.mockResolvedValue({ version: 1, exported_at: "", items: [{ id: "1" }] });

    // jsdom doesn't have URL.createObjectURL — define it
    URL.createObjectURL = vi.fn().mockReturnValue("blob:test");
    URL.revokeObjectURL = vi.fn();

    const user = userEvent.setup();
    render(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("匯出資料")).toBeInTheDocument();
    });

    await user.click(screen.getByText("匯出資料"));

    await waitFor(() => {
      expect(mockExportData).toHaveBeenCalled();
    });
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("匯出"));
  });

  it("theme toggle calls setTheme", async () => {
    setupDefaults();
    const user = userEvent.setup();
    render(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("深色模式")).toBeInTheDocument();
    });

    await user.click(screen.getByText("深色模式"));
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });
});
