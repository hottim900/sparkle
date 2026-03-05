import { test, expect } from "@playwright/test";
import { createCategoryViaApi, navigateTo } from "./helpers";

test.describe("Category management", () => {
  test("creates a new category from settings", async ({ page }) => {
    await page.goto("/");
    await navigateTo(page, "設定");

    await page.getByRole("button", { name: /新增分類/ }).click();

    const catName = `Create-${Date.now()}`;
    await page.getByPlaceholder("分類名稱").fill(catName);
    await page.getByTestId("color-#3b82f6").click();
    await page.getByRole("button", { name: "新增", exact: true }).click();

    await expect(page.getByText("已建立分類")).toBeVisible();
    // Verify the new category appears in the list
    await expect(page.getByText(catName)).toBeVisible();
  });

  test("renames a category", async ({ page, request }) => {
    const cat = await createCategoryViaApi(request, { name: `Rename-${Date.now()}` });

    await page.goto("/");
    await navigateTo(page, "設定");

    await expect(page.getByText(cat.name)).toBeVisible();

    const row = page.getByTestId("category-row").filter({ hasText: cat.name });
    await row.getByTitle("編輯").click();

    const input = page.getByPlaceholder("分類名稱");
    await input.clear();
    const newName = `Renamed-${Date.now()}`;
    await input.fill(newName);

    await page.getByRole("button", { name: "儲存", exact: true }).click();

    await expect(page.getByText("已更新分類")).toBeVisible();
    await expect(page.getByText(newName)).toBeVisible();
  });

  test("deletes a category with confirmation", async ({ page, request }) => {
    const cat = await createCategoryViaApi(request, { name: `Delete-${Date.now()}` });

    await page.goto("/");
    await navigateTo(page, "設定");

    await expect(page.getByText(cat.name)).toBeVisible();

    const row = page.getByTestId("category-row").filter({ hasText: cat.name });
    await row.getByTitle("刪除").click();

    await expect(page.getByText("確認刪除分類")).toBeVisible();
    await page.getByRole("button", { name: "刪除" }).click();

    await expect(page.getByText("已刪除分類")).toBeVisible();
    await expect(page.getByText(cat.name)).not.toBeVisible();
  });

  test("reorders categories", async ({ page, request }) => {
    const catA = await createCategoryViaApi(request, { name: `OrderA-${Date.now()}` });
    await createCategoryViaApi(request, { name: `OrderB-${Date.now()}` });

    await page.goto("/");
    await navigateTo(page, "設定");

    await expect(page.getByText(catA.name)).toBeVisible();

    // Move first visible category down
    const firstRow = page.getByTestId("category-row").filter({ hasText: catA.name });
    await firstRow.getByTitle("下移").click();

    // Wait for reorder API response
    await page.waitForResponse(
      (resp) => resp.url().includes("/api/categories/reorder") && resp.ok(),
    );
  });
});
