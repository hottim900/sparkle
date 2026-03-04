import { test, expect } from "@playwright/test";

import { createItemViaApi } from "./helpers";

test.describe("Dashboard", () => {
  test("displays stats cards with correct sections", async ({ page }) => {
    await page.goto("/");

    // Dashboard is the default route
    const heading = page.getByRole("heading", { name: "總覽" });
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // Scope stats verification to main content area (exclude sidebar nav buttons)
    const main = page.locator(".max-w-2xl");
    await expect(main.getByText("永久筆記")).toBeVisible();
    await expect(main.getByText("發展中")).toBeVisible();
    await expect(main.getByText("本週匯出")).toBeVisible();
  });

  test("focus section shows overdue todos", async ({ page, request }) => {
    // Create overdue todo (yesterday's date)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dueDate = yesterday.toISOString().split("T")[0]; // YYYY-MM-DD

    const title = `overdue-todo-${Date.now()}`;
    await createItemViaApi(request, {
      title,
      type: "todo",
      priority: "high",
      due: dueDate,
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "總覽" })).toBeVisible({ timeout: 10_000 });

    // Scope to main content area
    const main = page.locator(".max-w-2xl");
    await expect(main.getByText("今日焦點")).toBeVisible();
    await expect(main.getByText(title)).toBeVisible();
    await expect(main.getByText("已逾期").first()).toBeVisible();
  });
});
