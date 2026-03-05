import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithContext } from "@/test-utils";
import { CategoryManagement } from "../category-management";
import type { Category } from "@/lib/types";

const mockListCategories = vi.fn();
const mockCreateCategory = vi.fn();
const mockUpdateCategory = vi.fn();
const mockDeleteCategory = vi.fn();
const mockReorderCategories = vi.fn();

vi.mock("@/lib/api", () => ({
  listCategories: (...args: unknown[]) => mockListCategories(...args),
  createCategory: (...args: unknown[]) => mockCreateCategory(...args),
  updateCategory: (...args: unknown[]) => mockUpdateCategory(...args),
  deleteCategory: (...args: unknown[]) => mockDeleteCategory(...args),
  reorderCategories: (...args: unknown[]) => mockReorderCategories(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: "cat-1",
    name: "Work",
    sort_order: 0,
    color: "#3b82f6",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const threeCategories = [
  makeCategory({ id: "cat-1", name: "Work", sort_order: 0, color: "#3b82f6" }),
  makeCategory({ id: "cat-2", name: "Health", sort_order: 1, color: "#22c55e" }),
  makeCategory({ id: "cat-3", name: "Home", sort_order: 2, color: null }),
];

describe("CategoryManagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("list rendering", () => {
    it("shows empty state when no categories", async () => {
      mockListCategories.mockResolvedValue({ categories: [] });
      renderWithContext(<CategoryManagement />);

      await waitFor(() => {
        expect(screen.getByText("尚無分類")).toBeInTheDocument();
      });
      expect(screen.getByText(/點擊下方按鈕建立第一個分類/)).toBeInTheDocument();
    });

    it("renders categories sorted by sort_order", async () => {
      mockListCategories.mockResolvedValue({ categories: threeCategories });
      renderWithContext(<CategoryManagement />);

      await waitFor(() => {
        expect(screen.getByText("Work")).toBeInTheDocument();
      });
      expect(screen.getByText("Health")).toBeInTheDocument();
      expect(screen.getByText("Home")).toBeInTheDocument();
    });

    it("shows color dots for categories with color", async () => {
      mockListCategories.mockResolvedValue({ categories: threeCategories });
      renderWithContext(<CategoryManagement />);

      await waitFor(() => {
        expect(screen.getByText("Work")).toBeInTheDocument();
      });

      const colorDots = document.querySelectorAll("[data-testid='category-color-dot']");
      expect(colorDots.length).toBeGreaterThanOrEqual(2);
    });

    it("shows section title", async () => {
      mockListCategories.mockResolvedValue({ categories: [] });
      renderWithContext(<CategoryManagement />);

      await waitFor(() => {
        expect(screen.getByText("分類管理")).toBeInTheDocument();
      });
    });
  });

  describe("create", () => {
    beforeEach(() => {
      mockListCategories.mockResolvedValue({ categories: [] });
    });

    it("shows create form when '+ 新增分類' is clicked", async () => {
      const user = userEvent.setup();
      renderWithContext(<CategoryManagement />);

      await waitFor(() => {
        expect(screen.getByText("尚無分類")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /新增分類/ }));

      expect(screen.getByPlaceholderText("分類名稱")).toBeInTheDocument();
    });

    it("creates category on submit", async () => {
      const { toast } = await import("sonner");
      const user = userEvent.setup();
      const newCat = makeCategory({ id: "cat-new", name: "New Cat" });
      mockCreateCategory.mockResolvedValue(newCat);

      renderWithContext(<CategoryManagement />);

      await waitFor(() => {
        expect(screen.getByText("尚無分類")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /新增分類/ }));
      await user.type(screen.getByPlaceholderText("分類名稱"), "New Cat");

      // Select a color
      await user.click(screen.getByTestId("color-#3b82f6"));

      await user.click(screen.getByRole("button", { name: "新增" }));

      await waitFor(() => {
        expect(mockCreateCategory).toHaveBeenCalledWith({
          name: "New Cat",
          color: "#3b82f6",
        });
      });
      expect(toast.success).toHaveBeenCalledWith("已建立分類");
    });

    it("hides create form on cancel", async () => {
      const user = userEvent.setup();
      renderWithContext(<CategoryManagement />);

      await waitFor(() => {
        expect(screen.getByText("尚無分類")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /新增分類/ }));
      expect(screen.getByPlaceholderText("分類名稱")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "取消" }));

      expect(screen.queryByPlaceholderText("分類名稱")).not.toBeInTheDocument();
    });

    it("does not submit empty name", async () => {
      const user = userEvent.setup();
      renderWithContext(<CategoryManagement />);

      await waitFor(() => {
        expect(screen.getByText("尚無分類")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /新增分類/ }));
      expect(screen.getByRole("button", { name: "新增" })).toBeDisabled();
    });

    it("shows error toast on create failure", async () => {
      const { toast } = await import("sonner");
      const user = userEvent.setup();
      mockCreateCategory.mockRejectedValue(new Error("Category name already exists"));

      renderWithContext(<CategoryManagement />);

      await waitFor(() => {
        expect(screen.getByText("尚無分類")).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /新增分類/ }));
      await user.type(screen.getByPlaceholderText("分類名稱"), "Duplicate");
      await user.click(screen.getByRole("button", { name: "新增" }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });
    });
  });

  describe("edit", () => {
    beforeEach(() => {
      mockListCategories.mockResolvedValue({ categories: threeCategories });
    });

    it("shows edit form when edit button is clicked", async () => {
      const user = userEvent.setup();
      renderWithContext(<CategoryManagement />);

      await waitFor(() => {
        expect(screen.getByText("Work")).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle("編輯");
      await user.click(editButtons[0]);

      const input = screen.getByPlaceholderText("分類名稱");
      expect(input).toHaveValue("Work");
    });

    it("saves edited category", async () => {
      const { toast } = await import("sonner");
      const user = userEvent.setup();
      mockUpdateCategory.mockResolvedValue(makeCategory({ id: "cat-1", name: "Updated Work" }));

      renderWithContext(<CategoryManagement />);

      await waitFor(() => {
        expect(screen.getByText("Work")).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle("編輯");
      await user.click(editButtons[0]);

      const input = screen.getByPlaceholderText("分類名稱");
      await user.clear(input);
      await user.type(input, "Updated Work");

      await user.click(screen.getByRole("button", { name: "儲存" }));

      await waitFor(() => {
        expect(mockUpdateCategory).toHaveBeenCalledWith("cat-1", {
          name: "Updated Work",
          color: "#3b82f6",
        });
      });
      expect(toast.success).toHaveBeenCalledWith("已更新分類");
    });

    it("closes edit form on cancel", async () => {
      const user = userEvent.setup();
      renderWithContext(<CategoryManagement />);

      await waitFor(() => {
        expect(screen.getByText("Work")).toBeInTheDocument();
      });

      const editButtons = screen.getAllByTitle("編輯");
      await user.click(editButtons[0]);

      expect(screen.getByPlaceholderText("分類名稱")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "取消" }));

      expect(screen.queryByPlaceholderText("分類名稱")).not.toBeInTheDocument();
      expect(screen.getByText("Work")).toBeInTheDocument();
    });
  });
});
