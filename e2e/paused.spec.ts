import { test, expect } from "@playwright/test";
import { createItemViaApi, navigateTo } from "./helpers";

test.describe("Paused Items", () => {
  test("pause from detail view, item disappears from default list", async ({ page, request }) => {
    const item = await createItemViaApi(request, {
      title: `PauseTest ${Date.now()}`,
      type: "note",
    });

    await page.goto("/");
    await navigateTo(page, "閃念");
    await page.getByText(item.title).click();

    // Wait for detail panel
    await expect(page.getByPlaceholder("標題")).toBeVisible({ timeout: 10_000 });

    // Click pause button in the metadata area
    await page.getByRole("button", { name: "暫停", exact: true }).click();

    // Popover opens — click "不附備忘直接暫停"
    await page.getByText("不附備忘直接暫停").click();

    // Wait for PATCH to complete
    await expect(page.getByText("已暫停")).toBeVisible({ timeout: 5_000 });

    // Close detail
    await page.keyboard.press("Escape");

    // Item should disappear from fleeting list (default excludes paused)
    await expect(page.getByText(item.title)).not.toBeVisible({ timeout: 5_000 });
  });

  test("visit paused items page, paused item visible", async ({ page, request }) => {
    const item = await createItemViaApi(request, {
      title: `PausedVisible ${Date.now()}`,
      type: "todo",
      status: "active",
    });

    // Pause via API
    await request.patch(`http://localhost:${process.env.PORT || 3456}/api/items/${item.id}`, {
      headers: {
        Authorization: `Bearer ${process.env.AUTH_TOKEN || "e2e-test-token-that-is-long-enough-for-validation"}`,
        "Content-Type": "application/json",
      },
      data: { paused: true, pausedContext: "等待回覆" },
    });

    await page.goto("/");
    await navigateTo(page, "已暫停");

    // Item should be visible in paused list
    await expect(page.getByText(item.title)).toBeVisible({ timeout: 10_000 });
    // Context should be displayed
    await expect(page.getByText("等待回覆")).toBeVisible();
  });

  test("resume from paused items page, item returns to default list", async ({ page, request }) => {
    const item = await createItemViaApi(request, {
      title: `ResumeTest ${Date.now()}`,
      type: "note",
    });

    // Pause via API
    await request.patch(`http://localhost:${process.env.PORT || 3456}/api/items/${item.id}`, {
      headers: {
        Authorization: `Bearer ${process.env.AUTH_TOKEN || "e2e-test-token-that-is-long-enough-for-validation"}`,
        "Content-Type": "application/json",
      },
      data: { paused: true },
    });

    await page.goto("/");
    await navigateTo(page, "已暫停");

    // Wait for item to appear
    await expect(page.getByText(item.title)).toBeVisible({ timeout: 10_000 });

    // Click resume button next to the item
    const itemRow = page.getByText(item.title).locator("../..");
    await itemRow.getByRole("button", { name: /恢復/ }).click();

    // Wait for success toast
    await expect(page.getByText("已恢復")).toBeVisible({ timeout: 5_000 });

    // Item should disappear from paused list
    await expect(page.getByText(item.title)).not.toBeVisible({ timeout: 5_000 });

    // Navigate to fleeting and verify item is back
    await navigateTo(page, "閃念");
    await expect(page.getByText(item.title)).toBeVisible({ timeout: 5_000 });
  });

  test("pause with context displayed", async ({ page, request }) => {
    const item = await createItemViaApi(request, {
      title: `ContextTest ${Date.now()}`,
      type: "note",
    });

    await page.goto("/");
    await navigateTo(page, "閃念");
    await page.getByText(item.title).click();

    await expect(page.getByPlaceholder("標題")).toBeVisible({ timeout: 10_000 });

    // Click pause
    await page.getByRole("button", { name: "暫停", exact: true }).click();

    // Fill in context
    await page.getByPlaceholder("下次回來時，你想記住什麼？").fill("需要等設計稿");

    // Click the primary pause button in the popover
    // There are two buttons with "暫停" text — the popover's submit button
    const popoverPauseBtn = page.locator("[data-radix-popper-content-wrapper] button", {
      hasText: "暫停",
    });
    await popoverPauseBtn.click();

    await expect(page.getByText("已暫停")).toBeVisible({ timeout: 5_000 });

    // Navigate to paused list
    await page.keyboard.press("Escape");
    await navigateTo(page, "已暫停");

    await expect(page.getByText(item.title)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("需要等設計稿")).toBeVisible();
  });

  test("empty state message on paused page", async ({ page }) => {
    // Navigate to paused page — should show empty state
    // (assuming no paused items from other tests remain — tests run serially with fresh DB)
    await page.goto("/paused");
    await expect(page.getByText("目前沒有暫停中的項目")).toBeVisible({ timeout: 10_000 });
  });

  test("sidebar badge count shows when items are paused", async ({ page, request }) => {
    const item = await createItemViaApi(request, {
      title: `BadgeTest ${Date.now()}`,
      type: "note",
    });

    // Pause via API
    await request.patch(`http://localhost:${process.env.PORT || 3456}/api/items/${item.id}`, {
      headers: {
        Authorization: `Bearer ${process.env.AUTH_TOKEN || "e2e-test-token-that-is-long-enough-for-validation"}`,
        "Content-Type": "application/json",
      },
      data: { paused: true },
    });

    await page.goto("/");

    // Wait for sidebar to render with the badge count
    const pausedLink = page.getByTestId("sidebar").getByRole("link", { name: /已暫停/ });
    await expect(pausedLink).toBeVisible({ timeout: 10_000 });

    // The badge should show a count > 0
    // The badge is inside the link element
    await expect(pausedLink.locator('[data-slot="badge"]')).toBeVisible({ timeout: 5_000 });
  });
});
