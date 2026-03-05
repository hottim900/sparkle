import { test, expect } from "@playwright/test";

import { createItemViaApi } from "./helpers";

test.describe("Dashboard", () => {
  test("displays dashboard sections", async ({ page }) => {
    await page.goto("/");

    const heading = page.getByRole("heading", { name: "總覽" });
    await expect(heading).toBeVisible({ timeout: 10_000 });

    const main = page.locator(".max-w-2xl");
    await expect(main.getByText("需要關注", { exact: true })).toBeVisible();
    await expect(main.getByText("Zettelkasten 管道")).toBeVisible();
    await expect(main.getByText("本月活動")).toBeVisible();
  });

  test("focus section shows overdue todos", async ({ page, request }) => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dueDate = yesterday.toISOString().split("T")[0];

    const title = `overdue-todo-${Date.now()}`;
    await createItemViaApi(request, {
      title,
      type: "todo",
      priority: "high",
      due: dueDate,
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "總覽" })).toBeVisible({ timeout: 10_000 });

    const main = page.locator(".max-w-2xl");
    await expect(main.getByText("需要關注")).toBeVisible();
    await expect(main.getByText(title)).toBeVisible();
    await expect(main.getByText("已逾期").first()).toBeVisible();
  });
});
