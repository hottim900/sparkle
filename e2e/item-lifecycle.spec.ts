import { test, expect } from "@playwright/test";

/**
 * Helper: create a fleeting note via quick capture and open its detail panel.
 * Returns the generated title string.
 */
async function createNoteAndOpenDetail(page: import("@playwright/test").Page, prefix: string) {
  const title = `${prefix} ${Date.now()}`;

  // Navigate to fleeting notes view
  await page.getByRole("button", { name: "閃念" }).click();
  await expect(page.getByPlaceholder("快速記錄...")).toBeVisible();

  // Create note
  await page.getByPlaceholder("快速記錄...").fill(title);
  await page.locator("button[type='submit']").click();
  await expect(page.getByText("已新增")).toBeVisible({ timeout: 5_000 });

  // Open detail by clicking the item
  await page.getByText(title).click();

  // Wait for lazy-loaded detail panel (title input appears)
  const titleInput = page.getByPlaceholder("標題");
  await expect(titleInput).toBeVisible({ timeout: 10_000 });
  await expect(titleInput).toHaveValue(title);

  return title;
}

test.describe("Item Lifecycle", () => {
  test("edits title with auto-save and persists after reload", async ({ page }) => {
    await page.goto("/");
    await createNoteAndOpenDetail(page, "TitleEdit");

    // Fill new title
    const titleInput = page.getByPlaceholder("標題");
    const newTitle = `Renamed ${Date.now()}`;
    await titleInput.fill(newTitle);

    // Blur to trigger immediate save, and wait for PATCH to complete
    const savePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes("/api/items/") && resp.request().method() === "PATCH" && resp.ok(),
    );
    await titleInput.blur();
    await savePromise;

    // Reload and verify persistence via UI
    await page.reload();
    await page.getByRole("button", { name: "閃念" }).click();
    await expect(page.getByPlaceholder("快速記錄...")).toBeVisible();
    await expect(page.getByText(newTitle)).toBeVisible({ timeout: 10_000 });
  });

  test("edits content and auto-saves", async ({ page }) => {
    await page.goto("/");
    await createNoteAndOpenDetail(page, "ContentEdit");

    // Type content in textarea
    const content = `Test content ${Date.now()}`;
    await page.getByPlaceholder("Markdown 內容...").fill(content);

    // Wait for debounced auto-save (1500ms + network)
    await expect(page.getByText("已儲存")).toBeVisible({ timeout: 5_000 });

    // Close detail by pressing Escape, then reopen to verify persistence
    await page.keyboard.press("Escape");

    // Reopen the item from the list
    await page
      .getByText(/ContentEdit \d+/)
      .first()
      .click();
    await expect(page.getByPlaceholder("標題")).toBeVisible({ timeout: 10_000 });

    // Verify content persists
    await expect(page.getByPlaceholder("Markdown 內容...")).toHaveValue(content);
  });

  test("changes status from fleeting to developing", async ({ page }) => {
    await page.goto("/");
    const title = await createNoteAndOpenDetail(page, "StatusChange");

    // Click status select (find trigger by its current text "閃念")
    const statusTrigger = page.locator('[data-slot="select-trigger"]', { hasText: "閃念" });
    await statusTrigger.click();

    // Select "發展中" from the portal dropdown
    await page.getByRole("option", { name: "發展中" }).click();

    // Status saves immediately — verify the trigger now shows "發展中"
    const updatedStatusTrigger = page.locator('[data-slot="select-trigger"]', {
      hasText: "發展中",
    });
    await expect(updatedStatusTrigger).toBeVisible({ timeout: 3_000 });

    // Close detail and navigate to "發展中" view to verify
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "發展中" }).click();
    await expect(page.getByText(title)).toBeVisible({ timeout: 5_000 });
  });

  test("adds and removes a tag", async ({ page }) => {
    await page.goto("/");
    await createNoteAndOpenDetail(page, "TagTest");

    const tagName = `e2e-tag-${Date.now()}`;

    // Add tag via tag input (use click + keyboard.type to ensure React state updates)
    const tagInput = page.getByPlaceholder("新增標籤...");
    await tagInput.click();
    await page.keyboard.type(tagName);
    await page.keyboard.press("Enter");

    // Scope badge locator to the TagInput component (parent of parent of input)
    // TagInput structure: <div>(root) > <div>(badges) + <div>(input container) > <input>
    const tagInputRoot = tagInput.locator("../..");
    const tagBadge = tagInputRoot.locator('[data-slot="badge"]', { hasText: tagName });

    // Verify tag badge appears (saves immediately via saveField)
    await expect(tagBadge).toBeVisible({ timeout: 3_000 });

    // Remove tag by clicking X button inside the badge
    await tagBadge.locator("button").click({ force: true });

    // Verify tag badge disappears from the detail panel
    await expect(tagBadge).not.toBeVisible({ timeout: 5_000 });
  });

  test("deletes an item with confirmation", async ({ page }) => {
    await page.goto("/");
    const title = await createNoteAndOpenDetail(page, "DeleteTest");

    // Click delete button (trash icon in the header)
    // It's the last button in the header action row
    const deleteButton = page
      .getByRole("button")
      .filter({ has: page.locator("svg.text-destructive") });
    await deleteButton.click();

    // Confirmation dialog appears
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("確認刪除")).toBeVisible();

    // Click the destructive "刪除" button in the dialog
    await page.getByRole("dialog").getByRole("button", { name: "刪除" }).click();

    // Verify toast and item gone from list
    await expect(page.getByText("已刪除")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(title)).not.toBeVisible({ timeout: 5_000 });
  });

  test("converts note to todo with auto-status mapping", async ({ page }) => {
    await page.goto("/");
    const title = await createNoteAndOpenDetail(page, "TypeConvert");

    // Click type select (shows "筆記")
    const typeTrigger = page.locator('[data-slot="select-trigger"]', { hasText: "筆記" });
    await typeTrigger.click();

    // Select "待辦"
    await page.getByRole("option", { name: "待辦" }).click();

    // Type saves immediately — close detail
    await page.keyboard.press("Escape");

    // Navigate to active todos view — server auto-maps fleeting → active
    await page.getByRole("button", { name: "進行中" }).click();
    await expect(page.getByText(title)).toBeVisible({ timeout: 5_000 });
  });
});
