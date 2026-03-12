import { test, expect } from "@playwright/test";

import { createItemViaApi, navigateTo } from "./helpers";

test.describe("Keyboard Shortcuts", () => {
  test("/ focuses search input", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByPlaceholder("快速記錄...")).toBeVisible({ timeout: 10_000 });

    // Ensure no input is focused (keyboard shortcuts are ignored when input focused)
    await page.locator("body").click();

    // Press / to focus search
    await page.keyboard.press("/");
    await expect(page.getByPlaceholder("搜尋...")).toBeFocused();
  });

  test("Escape closes detail panel", async ({ page, request }) => {
    const title = `esc-test-${Date.now()}`;
    await createItemViaApi(request, { title, type: "note" });

    await page.goto("/");
    await navigateTo(page, "閃念");
    await page.getByText(title).click();
    const titleInput = page.getByPlaceholder("標題");
    await expect(titleInput).toBeVisible({ timeout: 10_000 });

    // Blur any focused input first (Escape in input blurs instead of closing)
    await titleInput.blur();

    // Press Escape to close detail panel
    await page.keyboard.press("Escape");
    await expect(titleInput).not.toBeVisible({ timeout: 5_000 });
  });
});
