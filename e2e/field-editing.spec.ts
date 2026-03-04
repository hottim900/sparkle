import { test, expect } from "@playwright/test";

import { createItemViaApi, navigateTo } from "./helpers";

test.describe("Field Editing", () => {
  test("edits source URL and persists", async ({ page, request }) => {
    const title = `source-url-${Date.now()}`;
    await createItemViaApi(request, { title, type: "note" });

    await page.goto("/");
    await navigateTo(page, "閃念");
    await page.getByText(title).click();
    await expect(page.getByPlaceholder("標題")).toBeVisible({ timeout: 10_000 });

    // Fill source URL
    const sourceInput = page.getByPlaceholder("https://...");
    await sourceInput.fill("https://example.com/test");

    // Blur to trigger immediate save
    const savePromise = page.waitForResponse(
      (r) => r.url().includes("/api/items/") && r.request().method() === "PATCH" && r.ok(),
    );
    await sourceInput.blur();
    await savePromise;

    // Reload and verify persistence
    await page.reload();
    await navigateTo(page, "閃念");
    await page.getByText(title).click();
    await expect(page.getByPlaceholder("標題")).toBeVisible({ timeout: 10_000 });
    await expect(sourceInput).toHaveValue("https://example.com/test");
  });

  test("adds and removes an alias", async ({ page, request }) => {
    const title = `alias-${Date.now()}`;
    const aliasName = `e2e-alias-${Date.now()}`;
    await createItemViaApi(request, { title, type: "note" });

    await page.goto("/");
    await navigateTo(page, "閃念");
    await page.getByText(title).click();
    await expect(page.getByPlaceholder("標題")).toBeVisible({ timeout: 10_000 });

    // Add alias via keyboard (same pattern as tags)
    const aliasInput = page.getByPlaceholder("新增別名...");
    await aliasInput.click();
    await page.keyboard.type(aliasName);

    const addSavePromise = page.waitForResponse(
      (r) => r.url().includes("/api/items/") && r.request().method() === "PATCH" && r.ok(),
    );
    await page.keyboard.press("Enter");
    await addSavePromise;

    // Scope badge to AliasInput component root (same DOM structure as TagInput)
    const aliasInputRoot = aliasInput.locator("../../..");
    const aliasBadge = aliasInputRoot.locator('[data-slot="badge"]', { hasText: aliasName });
    await expect(aliasBadge).toBeVisible({ timeout: 3_000 });

    // Remove alias by clicking X button
    const removeSavePromise = page.waitForResponse(
      (r) => r.url().includes("/api/items/") && r.request().method() === "PATCH" && r.ok(),
    );
    await aliasBadge.locator("button").click({ force: true });
    await removeSavePromise;

    // Verify badge gone
    await expect(aliasBadge).not.toBeVisible({ timeout: 5_000 });
  });

  test("source URL clears correctly", async ({ page, request }) => {
    const title = `source-clear-${Date.now()}`;
    await createItemViaApi(request, { title, type: "note" });

    await page.goto("/");
    await navigateTo(page, "閃念");
    await page.getByText(title).click();
    await expect(page.getByPlaceholder("標題")).toBeVisible({ timeout: 10_000 });

    const sourceInput = page.getByPlaceholder("https://...");

    // Set source URL
    await sourceInput.fill("https://example.com/to-clear");
    const savePromise1 = page.waitForResponse(
      (r) => r.url().includes("/api/items/") && r.request().method() === "PATCH" && r.ok(),
    );
    await sourceInput.blur();
    await savePromise1;

    // Clear source URL
    await sourceInput.fill("");
    const savePromise2 = page.waitForResponse(
      (r) => r.url().includes("/api/items/") && r.request().method() === "PATCH" && r.ok(),
    );
    await sourceInput.blur();
    await savePromise2;

    // Reload and verify cleared
    await page.reload();
    await navigateTo(page, "閃念");
    await page.getByText(title).click();
    await expect(page.getByPlaceholder("標題")).toBeVisible({ timeout: 10_000 });
    await expect(sourceInput).toHaveValue("");
  });
});
