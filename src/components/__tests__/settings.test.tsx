import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithContext } from "@/test-utils";
import { Settings } from "../settings";
import type { SettingsResponse } from "@/lib/types";

const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockExportData = vi.fn();
const mockImportData = vi.fn();
const mockSendLineBrief = vi.fn();

vi.mock("@/lib/api", () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
  exportData: (...args: unknown[]) => mockExportData(...args),
  importData: (...args: unknown[]) => mockImportData(...args),
  sendLineBrief: (...args: unknown[]) => mockSendLineBrief(...args),
  listCategories: vi.fn().mockResolvedValue({ categories: [] }),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  reorderCategories: vi.fn(),
}));

let mockTheme = "light";
const mockSetTheme = vi.fn();

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: mockTheme, setTheme: mockSetTheme }),
}));

const mockToast = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
);

vi.mock("sonner", () => ({
  toast: mockToast,
}));

function makeSettings(overrides: Partial<SettingsResponse> = {}): SettingsResponse {
  return {
    obsidian_enabled: "false",
    obsidian_vault_path: "/home/user/vault",
    obsidian_inbox_folder: "0_Inbox",
    obsidian_export_mode: "overwrite",
    recent_days: "7",
    stale_days: "14",
    line_brief_enabled: "true",
    line_brief_time: "21:00",
    ...overrides,
  };
}

function setupDefaults(settingsOverrides?: Partial<SettingsResponse>) {
  mockGetSettings.mockResolvedValue(makeSettings(settingsOverrides));
}

describe("Settings", () => {
  const onSettingsChanged = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockTheme = "light";
  });

  it("shows loading spinner initially", () => {
    mockGetSettings.mockReturnValue(new Promise(() => {}));

    renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);
    const spinner = document.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("renders settings after loading", async () => {
    setupDefaults();
    renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("設定")).toBeInTheDocument();
    });
    expect(screen.getByText("Obsidian 匯出")).toBeInTheDocument();
  });

  it("toggles obsidian enabled/disabled", async () => {
    setupDefaults();
    const user = userEvent.setup();
    renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("已停用")).toBeInTheDocument();
    });

    await user.click(screen.getByText("已停用"));
    // Both Obsidian and LINE brief now show "已啟用"
    expect(screen.getAllByText("已啟用").length).toBe(2);
  });

  it("vault path input is disabled when obsidian is off", async () => {
    setupDefaults({ obsidian_enabled: "false" });
    renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

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
    renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("已停用")).toBeInTheDocument();
    });

    // Toggle enable → makes hasChanges = true
    await user.click(screen.getByText("已停用"));

    // Click save (first "儲存設定" button = Obsidian section)
    const saveBtns = screen.getAllByText("儲存設定");
    await user.click(saveBtns[0]);

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
    renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("已停用")).toBeInTheDocument();
    });

    await user.click(screen.getByText("已停用"));
    const saveBtns = screen.getAllByText("儲存設定");
    await user.click(saveBtns[0]);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Server error");
    });
  });

  it("export data calls API and shows toast", async () => {
    const { toast } = await import("sonner");
    setupDefaults();
    mockExportData.mockResolvedValue({ version: 1, exported_at: "", items: [{ id: "1" }] });

    // jsdom doesn't have URL.createObjectURL — define it
    URL.createObjectURL = vi.fn().mockReturnValue("blob:test");
    URL.revokeObjectURL = vi.fn();

    const user = userEvent.setup();
    renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

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
    renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("深色模式")).toBeInTheDocument();
    });

    await user.click(screen.getByText("深色模式"));
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });

  it("renders LINE brief section", async () => {
    setupDefaults();
    renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("LINE 每日簡報")).toBeInTheDocument();
    });
    expect(screen.getByText("啟用每日簡報")).toBeInTheDocument();
  });

  it("toggles LINE brief enabled/disabled", async () => {
    setupDefaults({ line_brief_enabled: "true" });
    const user = userEvent.setup();
    renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("LINE 每日簡報")).toBeInTheDocument();
    });

    // Find the toggle in LINE brief section (third "已啟用" button)
    const enableButtons = screen.getAllByText("已啟用");
    const lineBriefToggle = enableButtons[enableButtons.length - 1]!;
    await user.click(lineBriefToggle);

    // Should now show "已停用"
    expect(screen.getAllByText("已停用").length).toBeGreaterThanOrEqual(1);
  });

  it("time input is disabled when LINE brief is off", async () => {
    setupDefaults({ line_brief_enabled: "false" });
    renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("LINE 每日簡報")).toBeInTheDocument();
    });

    const timeInput = screen.getByDisplayValue("21:00");
    expect(timeInput).toBeDisabled();
  });

  it("saves LINE brief settings", async () => {
    const { toast } = await import("sonner");
    setupDefaults({ line_brief_enabled: "true" });
    mockUpdateSettings.mockResolvedValue(makeSettings({ line_brief_enabled: "false" }));

    const user = userEvent.setup();
    renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("LINE 每日簡報")).toBeInTheDocument();
    });

    // Toggle to create a change
    const enableButtons = screen.getAllByText("已啟用");
    const lineBriefToggle = enableButtons[enableButtons.length - 1]!;
    await user.click(lineBriefToggle);

    // Click save (LINE brief section's "儲存設定" button)
    const saveBtns = screen.getAllByText("儲存設定");
    // LINE brief section's save is the third save button
    await user.click(saveBtns[2]);

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ line_brief_enabled: "false" }),
      );
    });
    expect(toast.success).toHaveBeenCalledWith("LINE 簡報設定已儲存");
  });

  it("sends LINE brief on button click", async () => {
    const { toast } = await import("sonner");
    setupDefaults();
    mockSendLineBrief.mockResolvedValue({ sent: true });

    const user = userEvent.setup();
    renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("立即發送")).toBeInTheDocument();
    });

    await user.click(screen.getByText("立即發送"));

    await waitFor(() => {
      expect(mockSendLineBrief).toHaveBeenCalled();
    });
    expect(toast.success).toHaveBeenCalledWith("LINE 簡報已發送");
  });

  it("shows skip reason when brief is skipped", async () => {
    setupDefaults();
    mockSendLineBrief.mockResolvedValue({
      sent: false,
      skipped: true,
      reason: "No actionable items (quiet day)",
    });

    const user = userEvent.setup();
    renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("立即發送")).toBeInTheDocument();
    });

    await user.click(screen.getByText("立即發送"));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("已跳過"));
    });
  });

  it("shows error toast when send brief fails", async () => {
    const { toast } = await import("sonner");
    setupDefaults();
    mockSendLineBrief.mockRejectedValue(new Error("Network error"));

    const user = userEvent.setup();
    renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

    await waitFor(() => {
      expect(screen.getByText("立即發送")).toBeInTheDocument();
    });

    await user.click(screen.getByText("立即發送"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Network error");
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

    it("disables save button when offline", async () => {
      setupDefaults();
      const user = userEvent.setup();
      renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

      await waitFor(() => {
        expect(screen.getByText("已停用")).toBeInTheDocument();
      });

      // Toggle to create a change
      await user.click(screen.getByText("已停用"));

      // Both save buttons should be disabled when offline
      const saveBtns = screen.getAllByRole("button", { name: /儲存設定/ });
      expect(saveBtns[0]).toBeDisabled();
    });

    it("keeps export button enabled when offline", async () => {
      setupDefaults();
      renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

      await waitFor(() => {
        expect(screen.getByText("匯出資料")).toBeInTheDocument();
      });

      expect(screen.getByText("匯出資料").closest("button")).not.toBeDisabled();
    });

    it("disables import button when offline", async () => {
      setupDefaults();
      renderWithContext(<Settings onSettingsChanged={onSettingsChanged} />);

      await waitFor(() => {
        expect(screen.getByText("匯入資料")).toBeInTheDocument();
      });

      expect(screen.getByText("匯入資料").closest("button")).toBeDisabled();
    });
  });
});
