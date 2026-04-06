import { test, expect } from "@playwright/test";
import { setupPrivatePin, createPrivateItemViaApi } from "./helpers";

test.describe("Private Note Advancement — Title Confirmation Modal", () => {
  let privateToken: string;

  test.beforeEach(async ({ request }) => {
    // Setup PIN and get session token via API
    privateToken = await setupPrivatePin(request);
  });

  test("auto-titled note shows title confirmation modal on advance", async ({ page, request }) => {
    // Create a private note with content only (no title) — server auto-derives title
    const content = "Auto-titled note content\nSecond line of content";
    await createPrivateItemViaApi(request, privateToken, {
      type: "note",
      content,
    });

    // Navigate to private page and unlock via UI
    await page.goto("/private");
    const pinInput = page.getByPlaceholder("6-12 位數字");
    await pinInput.waitFor({ timeout: 10_000 });
    await pinInput.fill("123456");
    await page.getByRole("button", { name: "解鎖" }).click();

    // Wait for items list to load and click the note
    await page.getByText("Auto-titled note content").first().click({ timeout: 10_000 });

    // Wait for detail view to load (title input has the auto-derived value)
    const titleInput = page.locator('input[class*="font-semibold"]');
    await expect(titleInput).toHaveValue("Auto-titled note content", { timeout: 10_000 });

    // Click "推進" button
    await page.getByRole("button", { name: "推進" }).click();

    // Title confirmation dialog should appear
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByText("確認標題")).toBeVisible();

    // Input should be pre-filled with auto-derived title
    const dialogInput = dialog.locator("input");
    await expect(dialogInput).toHaveValue("Auto-titled note content");

    // Edit the title
    await dialogInput.clear();
    await dialogInput.fill("Refined title");

    // Confirm
    await dialog.getByRole("button", { name: "確認推進" }).click();

    // Dialog should close and note should advance to "發展中"
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("已推進至「發展中」")).toBeVisible({ timeout: 5_000 });

    // Title should be updated in the detail view
    await expect(titleInput).toHaveValue("Refined title");
  });

  test("manually-titled note advances directly without modal", async ({ page, request }) => {
    // Create a private note with explicit title (not auto-derived)
    await createPrivateItemViaApi(request, privateToken, {
      type: "note",
      title: "Custom title",
      content: "Different first line\nMore content",
    });

    // Navigate and unlock
    await page.goto("/private");
    const pinInput = page.getByPlaceholder("6-12 位數字");
    await pinInput.waitFor({ timeout: 10_000 });
    await pinInput.fill("123456");
    await page.getByRole("button", { name: "解鎖" }).click();

    // Open the note
    await page.getByText("Custom title").first().click({ timeout: 10_000 });
    await expect(page.locator('input[class*="font-semibold"]')).toHaveValue("Custom title", {
      timeout: 10_000,
    });

    // Click "推進" — should advance directly, no modal
    await page.getByRole("button", { name: "推進" }).click();

    // Should see success toast, no dialog
    await expect(page.getByText("已推進至「發展中」")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("dialog")).not.toBeVisible();
  });
});
