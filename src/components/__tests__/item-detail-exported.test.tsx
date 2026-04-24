import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { type AppContextValue } from "@/lib/app-context";
import { ItemDetail } from "@/components/item-detail";
import type { Item } from "@/lib/types";
import * as api from "@/lib/api";
import { renderWithContext } from "@/test-utils";

vi.mock("@/lib/api");

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

const mockExportedItem: Item = {
  id: "test-exported-1",
  type: "note",
  title: "Test Exported Note",
  content: "# Hello\n\nWorld",
  status: "exported",
  export_path: "inbox/test-exported-note.md",
  priority: null,
  due: null,
  tags: '["test"]',
  source: null,
  origin_source: "web",
  aliases: "[]",
  linked_note_id: null,
  linked_note_title: null,
  linked_todo_count: 0,
  share_visibility: null,
  category_id: null,
  category_name: null,
  viewed_at: "2026-01-01T00:00:00.000Z",
  is_private: 0,
  origin: "vault",
  paused: 0,
  paused_at: null,
  paused_context: null,
  created: "2026-01-01T00:00:00.000Z",
  modified: "2026-01-01T00:00:00.000Z",
};

const mockExportedItemNoPath: Item = {
  ...mockExportedItem,
  export_path: null,
};

const mockExportedItemWithCategory: Item = {
  ...mockExportedItem,
  category_id: "cat-1",
  category_name: "工作",
  priority: "high",
  tags: '["test","zettelkasten"]',
};

function setupDefaultMocks(item: Item = mockExportedItem) {
  vi.mocked(api.getItem).mockResolvedValue(item);
  vi.mocked(api.getTags).mockResolvedValue({ tags: [] });
  vi.mocked(api.getLinkedTodos).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.listCategories).mockResolvedValue({ categories: [] });
  vi.mocked(api.getVaultPathBySparkleId).mockResolvedValue({
    path: "inbox/test-exported-note.md",
  });
}

function renderItemDetail(contextOverrides: Partial<AppContextValue> = {}) {
  return renderWithContext(<ItemDetail itemId="test-exported-1" />, contextOverrides);
}

describe("ItemDetail - exported read-only mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders VaultMarkdownPreview for exported items (no textarea)", async () => {
    renderItemDetail();

    // Wait for content to load — VaultMarkdownPreview renders markdown
    await waitFor(() => {
      // The markdown "# Hello" renders as a heading, and "World" as a paragraph
      expect(screen.getByText("Hello")).toBeInTheDocument();
      expect(screen.getByText("World")).toBeInTheDocument();
    });

    // Should NOT have a textarea (ItemContentEditor is not rendered)
    expect(screen.queryByRole("textbox", { name: /內容/ })).not.toBeInTheDocument();
    // The content textarea from ItemContentEditor has a specific class; just verify no textarea
    const textareas = document.querySelectorAll("textarea");
    expect(textareas.length).toBe(0);
  });

  it("shows exported marker + header vault-origin bar with path + vault link", async () => {
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("已匯出至 Obsidian")).toBeInTheDocument();
    });

    // Vault-origin header bar: "位於 vault · {export_path}"
    await waitFor(() => {
      expect(screen.getByText(/位於 vault/)).toBeInTheDocument();
      expect(screen.getByText(/inbox\/test-exported-note\.md/)).toBeInTheDocument();
    });

    // Vault link appears after sparkle_id API resolves
    await waitFor(() => {
      expect(screen.getByText("在 Vault 中查看")).toBeInTheDocument();
    });
  });

  it("header shows release button on vault-origin item (not delete button)", async () => {
    renderItemDetail();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "釋出" })).toBeInTheDocument();
    });
    // The normal delete icon button should not appear for a vault item
    expect(screen.queryByRole("button", { name: "刪除" })).not.toBeInTheDocument();
  });

  it("shows fallback when vault path not found", async () => {
    setupDefaultMocks(mockExportedItemNoPath);
    vi.mocked(api.getVaultPathBySparkleId).mockRejectedValue(new Error("Not found"));
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("已匯出至 Obsidian")).toBeInTheDocument();
    });

    // Should show fallback message, not vault link
    await waitFor(() => {
      expect(screen.getByText("Vault 中未找到對應檔案")).toBeInTheDocument();
    });
    expect(screen.queryByText("在 Vault 中查看")).not.toBeInTheDocument();
  });

  it("hides edit fields for exported items (no inputs)", async () => {
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("已匯出至 Obsidian")).toBeInTheDocument();
    });

    // No status select, priority select, type select (these are part of the editable view)
    expect(screen.queryByPlaceholderText("https://...")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("新增別名...")).not.toBeInTheDocument();

    // No category select
    expect(screen.queryByText("分類")).not.toBeInTheDocument();

    // No tag input
    expect(screen.queryByText("標籤")).not.toBeInTheDocument();
  });

  it("renders title as h1 not Input", async () => {
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("Test Exported Note")).toBeInTheDocument();
    });

    // Title should be an h1 element
    const h1 = screen.getByText("Test Exported Note");
    expect(h1.tagName).toBe("H1");

    // No title input
    expect(screen.queryByPlaceholderText("標題")).not.toBeInTheDocument();
  });

  it("shows metadata above content", async () => {
    setupDefaultMocks(mockExportedItemWithCategory);
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("Test Exported Note")).toBeInTheDocument();
    });

    // Metadata line shows type (appears twice: header bar + metadata span)
    const noteLabels = screen.getAllByText("筆記");
    expect(noteLabels.length).toBeGreaterThanOrEqual(2);

    // Category name
    expect(screen.getByText("工作")).toBeInTheDocument();

    // Tags rendered as badges
    expect(screen.getByText("zettelkasten")).toBeInTheDocument();

    // Priority — rendered as "高" + "優先" in separate text nodes
    expect(screen.getByText(/高/)).toBeInTheDocument();
    expect(screen.getByText(/優先/)).toBeInTheDocument();
  });
});
