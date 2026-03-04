import { test, expect } from "@playwright/test";
import { createItemViaApi, createCategoryViaApi, navigateTo, selectRadixOption } from "./helpers";
import { AUTH_TOKEN } from "../playwright.config";

const PORT = process.env.PORT || 3456;
const API_BASE = `http://localhost:${PORT}/api`;

test.describe("Category workflow", () => {
  test("creates a new category from item detail", async ({ page, request }) => {
    const categoryName = `Cat-${Date.now()}`;
    await createItemViaApi(request, { title: "Note for new cat", type: "note" });

    await page.goto("/");
    await navigateTo(page, "閃念");
    await page.getByText("Note for new cat").click();

    // Open category select and click "+ 新增分類"
    const categoryTrigger = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: "未分類" });
    await categoryTrigger.click();
    await page.getByRole("option", { name: "+ 新增分類" }).click();

    // Fill category name and submit
    const categoryInput = page.getByPlaceholder("分類名稱...");
    await expect(categoryInput).toBeVisible();
    await categoryInput.fill(categoryName);

    const savePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/items/") && resp.request().method() === "PATCH" && resp.ok(),
    );
    await categoryInput.press("Enter");
    await savePromise;

    // Verify category is now selected
    await expect(
      page.locator('[data-slot="select-trigger"]').filter({ hasText: categoryName }),
    ).toBeVisible();
  });

  test("assigns existing category to item", async ({ page, request }) => {
    const categoryName = `Existing-${Date.now()}`;
    await createCategoryViaApi(request, { name: categoryName });
    await createItemViaApi(request, { title: "Note for existing cat", type: "note" });

    await page.goto("/");
    await navigateTo(page, "閃念");
    await page.getByText("Note for existing cat").click();

    const categoryTrigger = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: "未分類" });

    const savePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/items/") && resp.request().method() === "PATCH" && resp.ok(),
    );
    await selectRadixOption(page, categoryTrigger, categoryName);
    await savePromise;

    // Verify persistence after reload
    await page.reload();
    await navigateTo(page, "閃念");
    await page.getByText("Note for existing cat").click();
    await expect(
      page.locator('[data-slot="select-trigger"]').filter({ hasText: categoryName }),
    ).toBeVisible();
  });

  test("clears category by selecting 未分類", async ({ page, request }) => {
    const categoryName = `ToClear-${Date.now()}`;
    const cat = await createCategoryViaApi(request, { name: categoryName });
    await createItemViaApi(request, {
      title: "Note to uncategorize",
      type: "note",
      category_id: cat.id,
    });

    await page.goto("/");
    await navigateTo(page, "閃念");
    await page.getByText("Note to uncategorize").click();

    // Verify category is shown
    const categoryTrigger = page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: categoryName });
    await expect(categoryTrigger).toBeVisible();

    // Select 未分類
    const savePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/items/") && resp.request().method() === "PATCH" && resp.ok(),
    );
    await selectRadixOption(page, categoryTrigger, "未分類");
    await savePromise;

    // Verify shows 未分類
    await expect(
      page.locator('[data-slot="select-trigger"]').filter({ hasText: "未分類" }),
    ).toBeVisible();
  });

  test("deletes category and items show 未分類", async ({ page, request }) => {
    const categoryName = `ToDelete-${Date.now()}`;
    const cat = await createCategoryViaApi(request, { name: categoryName });
    await createItemViaApi(request, {
      title: "Note with deleted cat",
      type: "note",
      category_id: cat.id,
    });

    // Delete category via API
    await request.delete(`${API_BASE}/categories/${cat.id}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });

    await page.goto("/");
    await navigateTo(page, "閃念");
    await page.getByText("Note with deleted cat").click();

    // Verify shows 未分類 after category deletion (FK ON DELETE SET NULL)
    await expect(
      page.locator('[data-slot="select-trigger"]').filter({ hasText: "未分類" }),
    ).toBeVisible();
  });
});
