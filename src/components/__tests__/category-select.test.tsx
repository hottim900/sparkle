import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test-utils";
import { CategorySelect } from "@/components/category-select";
import * as api from "@/lib/api";
import type { Category } from "@/lib/types";

vi.mock("@/lib/api");

// Polyfills for Radix Select in jsdom
beforeEach(() => {
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

const mockCategories: Category[] = [
  {
    id: "cat-1",
    name: "工作",
    sort_order: 0,
    color: "#ff0000",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "cat-2",
    name: "學習",
    sort_order: 1,
    color: null,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
  },
];

function setupMocks(categories: Category[] = mockCategories) {
  vi.mocked(api.listCategories).mockResolvedValue({ categories });
}

function renderCategorySelect(props: {
  value: string | null;
  onChange: ReturnType<typeof vi.fn>;
  disabled?: boolean;
}) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <CategorySelect {...props} />
    </QueryClientProvider>,
  );
}

describe("CategorySelect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it("renders with '未分類' when value is null", async () => {
    renderCategorySelect({ value: null, onChange: vi.fn() });

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toHaveTextContent("未分類");
    });
  });

  it("renders category name when value matches a category", async () => {
    renderCategorySelect({ value: "cat-1", onChange: vi.fn() });

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toHaveTextContent("工作");
    });
  });

  it("calls onChange with null when '未分類' is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderCategorySelect({ value: "cat-1", onChange });

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toHaveTextContent("工作");
    });

    await user.click(screen.getByRole("combobox"));

    const option = await screen.findByRole("option", { name: /未分類/ });
    await user.click(option);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("calls onChange with category id when a category is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderCategorySelect({ value: null, onChange });

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toHaveTextContent("未分類");
    });

    await user.click(screen.getByRole("combobox"));

    const option = await screen.findByRole("option", { name: /學習/ });
    await user.click(option);

    expect(onChange).toHaveBeenCalledWith("cat-2");
  });

  it("shows inline input when '+ 新增分類' is clicked", async () => {
    const user = userEvent.setup();
    renderCategorySelect({ value: null, onChange: vi.fn() });

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toHaveTextContent("未分類");
    });

    await user.click(screen.getByRole("combobox"));

    const option = await screen.findByRole("option", { name: /新增分類/ });
    await user.click(option);

    expect(screen.getByPlaceholderText("分類名稱...")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("分類名稱...")).toHaveFocus();
  });

  it("creates category and selects it on Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const newCategory: Category = {
      id: "cat-new",
      name: "新分類",
      sort_order: 2,
      color: null,
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:00:00.000Z",
    };
    vi.mocked(api.createCategory).mockResolvedValue(newCategory);

    renderCategorySelect({ value: null, onChange });

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toHaveTextContent("未分類");
    });

    // Open dropdown and click "+ 新增分類"
    await user.click(screen.getByRole("combobox"));
    const option = await screen.findByRole("option", { name: /新增分類/ });
    await user.click(option);

    // Type and submit
    const input = screen.getByPlaceholderText("分類名稱...");
    await user.type(input, "新分類{Enter}");

    await waitFor(() => {
      expect(api.createCategory).toHaveBeenCalledWith({ name: "新分類" });
      expect(onChange).toHaveBeenCalledWith("cat-new");
    });
  });

  it("hides input on Escape", async () => {
    const user = userEvent.setup();
    renderCategorySelect({ value: null, onChange: vi.fn() });

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toHaveTextContent("未分類");
    });

    await user.click(screen.getByRole("combobox"));
    const option = await screen.findByRole("option", { name: /新增分類/ });
    await user.click(option);

    const input = screen.getByPlaceholderText("分類名稱...");
    expect(input).toBeInTheDocument();

    await user.click(input);
    await user.keyboard("{Escape}");

    expect(screen.queryByPlaceholderText("分類名稱...")).not.toBeInTheDocument();
  });

  it("respects disabled prop", async () => {
    renderCategorySelect({ value: null, onChange: vi.fn(), disabled: true });

    await waitFor(() => {
      expect(screen.getByRole("combobox")).toBeDisabled();
    });
  });
});
