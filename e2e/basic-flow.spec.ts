import { test, expect } from "@playwright/test";
import { AUTH_TOKEN } from "../playwright.config";

test.describe("Login", () => {
  test.use({ storageState: { cookies: [], origins: [] } }); // No auth

  test("shows login screen and authenticates with valid token", async ({ page }) => {
    await page.goto("/");

    // Login screen visible
    await expect(page.getByText("請輸入存取權杖以登入")).toBeVisible();

    // Enter token and submit
    await page.getByPlaceholder("存取權杖").fill(AUTH_TOKEN);
    await page.getByRole("button", { name: "登入" }).click();

    // Main app loads — desktop default view is dashboard
    await expect(page.getByText("總覽")).toBeVisible({ timeout: 10_000 });
  });

  test("shows error for invalid token", async ({ page }) => {
    await page.goto("/");

    await page.getByPlaceholder("存取權杖").fill("wrong-token-that-is-definitely-invalid");
    await page.getByRole("button", { name: "登入" }).click();

    await expect(page.getByText("權杖無效")).toBeVisible();
  });
});

test.describe("Quick Capture", () => {
  test("creates a fleeting note", async ({ page }) => {
    await page.goto("/");

    // Navigate to fleeting notes view (sidebar)
    await page.getByRole("button", { name: "閃念" }).click();

    // Quick capture input should now be visible
    await expect(page.getByPlaceholder("快速記錄...")).toBeVisible();

    const noteTitle = `E2E test note ${Date.now()}`;
    await page.getByPlaceholder("快速記錄...").fill(noteTitle);
    await page.locator("button[type='submit']").click();

    // Verify toast
    await expect(page.getByText("已新增")).toBeVisible({ timeout: 5_000 });

    // Verify note appears in the list
    await expect(page.getByText(noteTitle)).toBeVisible({ timeout: 5_000 });
  });

  test("creates a todo", async ({ page }) => {
    await page.goto("/");

    // Navigate to active todos view
    await page.getByRole("button", { name: "進行中" }).click();

    // Quick capture should show with todo type pre-selected
    await expect(page.getByPlaceholder("新增待辦...")).toBeVisible();

    const todoTitle = `E2E test todo ${Date.now()}`;
    await page.getByPlaceholder("新增待辦...").fill(todoTitle);
    await page.locator("button[type='submit']").click();

    // Verify toast
    await expect(page.getByText("已新增")).toBeVisible({ timeout: 5_000 });

    // Verify todo appears in the list
    await expect(page.getByText(todoTitle)).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Search", () => {
  test("finds a created note via search", async ({ page }) => {
    await page.goto("/");

    // Navigate to fleeting notes
    await page.getByRole("button", { name: "閃念" }).click();
    await expect(page.getByPlaceholder("快速記錄...")).toBeVisible();

    // Create a note with a unique title
    const uniqueTitle = `SearchTarget ${Date.now()}`;
    await page.getByPlaceholder("快速記錄...").fill(uniqueTitle);
    await page.locator("button[type='submit']").click();
    await expect(page.getByText("已新增")).toBeVisible({ timeout: 5_000 });

    // Use the sidebar search bar (placeholder "搜尋...")
    const searchInput = page.getByPlaceholder("搜尋...");
    await searchInput.fill(uniqueTitle);

    // Wait for debounced search results (300ms debounce + network)
    await expect(page.getByText("找到 1 個結果")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(uniqueTitle).first()).toBeVisible();
  });
});

test.describe("Item Detail", () => {
  test("opens detail panel when clicking an item", async ({ page }) => {
    await page.goto("/");

    // Navigate to fleeting notes
    await page.getByRole("button", { name: "閃念" }).click();
    await expect(page.getByPlaceholder("快速記錄...")).toBeVisible();

    // Create a note
    const noteTitle = `DetailTest ${Date.now()}`;
    await page.getByPlaceholder("快速記錄...").fill(noteTitle);
    await page.locator("button[type='submit']").click();
    await expect(page.getByText("已新增")).toBeVisible({ timeout: 5_000 });

    // Click the note in the list
    await page.getByText(noteTitle).click();

    // Verify detail panel opens with the title in an input
    await expect(page.locator(`input[value="${noteTitle}"]`)).toBeVisible({ timeout: 10_000 });
  });
});
