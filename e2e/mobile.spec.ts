import { test, expect } from "@playwright/test";
import { createItemViaApi, quickCaptureNote } from "./helpers";

test.describe("Mobile viewport", () => {
  test("bottom navigation tabs switch views", async ({ page }) => {
    await page.goto("/");

    // Mobile defaults to notes view — bottom nav should be visible
    const bottomNav = page.getByRole("navigation");
    await expect(bottomNav).toBeVisible();

    // Navigate to todos
    await bottomNav.getByRole("button", { name: "待辦" }).click();
    await expect(page.getByPlaceholder("新增待辦...")).toBeVisible();

    // Navigate to scratch
    await bottomNav.getByRole("button", { name: "暫存" }).click();
    await expect(page.getByPlaceholder("暫存筆記...")).toBeVisible();

    // Navigate to dashboard
    await bottomNav.getByRole("button", { name: "儀表板" }).click();
    await expect(page.getByRole("heading", { name: "總覽" })).toBeVisible();

    // Navigate back to notes
    await bottomNav.getByRole("button", { name: "筆記" }).click();
    await expect(page.getByPlaceholder("快速記錄...")).toBeVisible();
  });

  test("quick capture creates a note", async ({ page }) => {
    await page.goto("/");
    await quickCaptureNote(page, "Mobile test note");
    await expect(page.getByText("Mobile test note")).toBeVisible();
  });

  test("tag input + button adds a tag", async ({ page }) => {
    await page.goto("/");

    // Expand the quick capture form — the expand button has no accessible name,
    // it's the 2nd icon button in the input row (after theme toggle)
    const captureRow = page.getByPlaceholder("快速記錄...").locator("xpath=..");
    await captureRow.getByRole("button").nth(1).click();

    // Type a tag name
    await page.getByPlaceholder("新增標籤...").fill("mobile-tag");

    // Click the "+" button to add the tag
    await page.getByRole("button", { name: "新增標籤" }).click();

    // Verify the tag badge appears
    await expect(page.getByText("mobile-tag")).toBeVisible();
  });

  test("item detail shows content", async ({ page, request }) => {
    await createItemViaApi(request, {
      title: "Mobile detail test",
      content: "Content visible on mobile",
    });

    await page.goto("/");
    await page.getByText("Mobile detail test").click();

    await expect(page.getByPlaceholder("標題")).toHaveValue("Mobile detail test");
    await expect(page.getByText("Content visible on mobile")).toBeVisible();
  });

  test("search finds items", async ({ page, request }) => {
    await createItemViaApi(request, {
      title: "Unique mobile search target",
    });

    await page.goto("/");

    // Tap search in bottom nav
    const bottomNav = page.getByRole("navigation");
    await bottomNav.getByRole("button", { name: "搜尋" }).click();

    // The mobile search view input (sidebar's search is hidden via display:none)
    const searchInput = page.getByPlaceholder("搜尋...").last();
    await searchInput.fill("Unique mobile search");

    // Verify result appears
    await expect(page.getByText("Unique mobile search target")).toBeVisible({
      timeout: 10_000,
    });
  });
});
