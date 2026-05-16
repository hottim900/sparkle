import { test, expect } from "@playwright/test";

import { createItemViaApi } from "./helpers";

test.describe("Search by id: syntax", () => {
  test("shows id: hint when search is empty, hides once user types", async ({ page }) => {
    await page.goto("/");
    const searchInput = page.getByPlaceholder("搜尋...");

    await searchInput.click();
    await expect(page.getByText("可以用筆記 ID")).toBeVisible();

    await searchInput.fill("anything");
    await expect(page.getByText("可以用筆記 ID")).not.toBeVisible();
  });

  test("id:<full-uuid> finds the item and click-through opens detail", async ({
    page,
    request,
  }) => {
    const title = `IdSearchFull ${Date.now()}`;
    const created = await createItemViaApi(request, { title });
    const itemId = created.item?.id ?? created.id;

    await page.goto("/");
    await page.getByPlaceholder("搜尋...").fill(`id:${itemId}`);

    await expect(page.getByText("找到 1 個結果")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(title).first()).toBeVisible();

    await page.getByText(title).first().click();
    await expect(page.locator(`input[value="${title}"]`)).toBeVisible({ timeout: 10_000 });
  });

  test("id:<short hex prefix> finds the item", async ({ page, request }) => {
    const title = `IdSearchPrefix ${Date.now()}`;
    const created = await createItemViaApi(request, { title });
    const itemId = created.item?.id ?? created.id;

    await page.goto("/");
    await page.getByPlaceholder("搜尋...").fill(`id:${itemId.slice(0, 8)}`);

    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 });
  });

  test("id:<prefix-with-dash> works after dash stripping (T1)", async ({ page, request }) => {
    const title = `IdSearchDashy ${Date.now()}`;
    const created = await createItemViaApi(request, { title });
    const itemId: string = created.item?.id ?? created.id;

    await page.goto("/");
    // First 13 chars of UUID = 8 hex + dash + 4 hex (e.g. "abc12345-1111")
    await page.getByPlaceholder("搜尋...").fill(`id:${itemId.slice(0, 13)}`);

    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 });
  });

  test("id:<unmatched-hex> shows ID-specific empty state, not generic", async ({ page }) => {
    await page.goto("/");
    // Hex prefix that's valid syntax but won't match any stored UUID
    // (UUIDs are random 122-bit; collision with this exact 12-char run is astronomically unlikely)
    await page.getByPlaceholder("搜尋...").fill("id:fadeadbe0000");

    await expect(page.getByText(/找不到此 ID/)).toBeVisible({ timeout: 10_000 });
  });

  test("plain FTS no-match shows generic empty state (not ID-specific)", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("搜尋...").fill(`ZzqNoMatch${Date.now()}`);

    await expect(page.getByText("找不到結果", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/找不到此 ID/)).not.toBeVisible();
  });
});
