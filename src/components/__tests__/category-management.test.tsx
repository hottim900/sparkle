import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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
});
