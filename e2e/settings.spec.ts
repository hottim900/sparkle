import { test, expect } from "@playwright/test";

test.describe("Settings", () => {
  test("loads settings page with all sections", async ({ page }) => {
    await page.goto("/");

    // Navigate to settings
    await page.getByRole("button", { name: "設定" }).click();

    // Verify page heading (lazy-loaded)
    await expect(page.getByRole("heading", { name: "設定" })).toBeVisible({
      timeout: 10_000,
    });

    // Verify all three section headings
    await expect(page.getByRole("heading", { name: "Obsidian 匯出" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "分享管理" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "一般" })).toBeVisible();

    // Verify key elements within sections
    await expect(page.getByText("啟用 Obsidian 匯出")).toBeVisible();
    await expect(page.getByRole("button", { name: "匯出資料" })).toBeVisible();
  });

  test("toggles theme between light and dark", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定" })).toBeVisible({
      timeout: 10_000,
    });

    const html = page.locator("html");
    const initialClass = (await html.getAttribute("class")) ?? "";
    const isInitiallyDark = initialClass.includes("dark");

    // Click theme toggle
    const themeButton = page.getByRole("button", {
      name: isInitiallyDark ? "淺色模式" : "深色模式",
    });
    await themeButton.click();

    // Verify class changed
    if (isInitiallyDark) {
      await expect(html).not.toHaveClass(/dark/);
    } else {
      await expect(html).toHaveClass(/dark/);
    }

    // Toggle back
    const toggledButton = page.getByRole("button", {
      name: isInitiallyDark ? "深色模式" : "淺色模式",
    });
    await toggledButton.click();

    // Verify reverted
    if (isInitiallyDark) {
      await expect(html).toHaveClass(/dark/);
    } else {
      await expect(html).not.toHaveClass(/dark/);
    }
  });

  test("exports data as JSON download", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定" })).toBeVisible({
      timeout: 10_000,
    });

    // Set up download listener before clicking
    const downloadPromise = page.waitForEvent("download");

    // Click export button
    await page.getByRole("button", { name: "匯出資料" }).click();

    // Verify download triggered
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^sparkle-backup-\d{4}-\d{2}-\d{2}\.json$/);

    // Verify toast
    await expect(page.getByText(/已匯出 \d+ 筆資料/)).toBeVisible({ timeout: 5_000 });
  });
});
