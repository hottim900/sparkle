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

  it("renders content_snippet as a read-only <pre> for exported items (no textarea)", async () => {
    renderItemDetail();

    // Wait for the content_snippet pre block to mount. The item content in
    // the fixture is "# Hello\n\nWorld", which the <pre> renders as raw text.
    await waitFor(() => {
      expect(screen.getByText("內容預覽")).toBeInTheDocument();
    });
    const pre = document.querySelector("pre");
    expect(pre).toBeTruthy();
    // Raw markdown text is rendered verbatim, not parsed
    expect(pre?.textContent).toContain("# Hello");
    expect(pre?.textContent).toContain("World");

    // No editable textareas
    expect(screen.queryByRole("textbox", { name: /內容/ })).not.toBeInTheDocument();
    const textareas = document.querySelectorAll("textarea");
    expect(textareas.length).toBe(0);
  });

  it("content_snippet <pre> has overflow guards (whitespace-pre-wrap + break-words + max-h + overflow-hidden)", async () => {
    const longSnippet = "a".repeat(500);
    const itemWithSnippet: Item = {
      ...mockExportedItem,
      content: longSnippet,
      content_snippet: longSnippet,
    };
    setupDefaultMocks(itemWithSnippet);
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("內容預覽")).toBeInTheDocument();
    });
    const pre = document.querySelector("pre");
    expect(pre).toBeTruthy();
    const cls = pre!.className;
    // Design contract per plan item 16: these classes prevent the horizontal-
    // scroll regressions from PRs #298-#301.
    expect(cls).toContain("whitespace-pre-wrap");
    expect(cls).toContain("break-words");
    expect(cls).toContain("max-h-32");
    expect(cls).toContain("overflow-hidden");
    // Gradient fade sibling exists to soften the clipped bottom edge.
    expect(pre!.querySelector("span.bg-gradient-to-b")).toBeTruthy();
  });

  it("shows exported marker + header vault-origin bar with path + vault link", async () => {
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("已匯出至 Obsidian")).toBeInTheDocument();
    });

    // Vault-origin header bar: "位於 vault · {vault_path}" (sourced from
    // useVaultPathBySparkleId reverse-lookup mock).
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
    // Reverse-lookup is the only source of truth — null = deleted from vault.
    setupDefaultMocks(mockExportedItem);
    vi.mocked(api.getVaultPathBySparkleId).mockResolvedValue(null);
    renderItemDetail();

    await waitFor(() => {
      expect(screen.getByText("已匯出至 Obsidian")).toBeInTheDocument();
    });

    // Reverse-lookup returned null → canonical "deleted" string per R3-D3
    // (索引更新中… / 此檔案已從 Vault 刪除). The string appears in both the
    // slate bar (header) and the body link area.
    await waitFor(() => {
      expect(screen.getAllByText("此檔案已從 Vault 刪除").length).toBeGreaterThan(0);
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
