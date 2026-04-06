import { test, expect } from "@playwright/test";

import { navigateTo, NOTE_CAPTURE_PLACEHOLDER } from "./helpers";

test.describe("Quick Capture Multi-line + Auto-title", () => {
  test("multi-line note: first line becomes title", async ({ page }) => {
    await page.goto("/");
    await navigateTo(page, "閃念");

    const textarea = page.getByPlaceholder(NOTE_CAPTURE_PLACEHOLDER);
    await expect(textarea).toBeVisible({ timeout: 10_000 });

    // Type multi-line content
    const firstLine = `MultiLine ${Date.now()}`;
    const secondLine = "This is the second line of content";
    await textarea.fill(`${firstLine}\n${secondLine}`);

    // Submit via clicking the submit button
    await page.getByRole("button", { name: "送出" }).click();
    await expect(page.getByText("已新增")).toBeVisible({ timeout: 5_000 });

    // Title should be the first line — verify it appears in the list
    await expect(page.getByText(firstLine)).toBeVisible({ timeout: 5_000 });

    // Open detail and verify title is first line, content has both lines
    await page.getByText(firstLine).click();
    await expect(page.getByPlaceholder("標題", { exact: true })).toHaveValue(firstLine, {
      timeout: 10_000,
    });
    // Switch to edit mode (default is preview)
    await page.getByRole("button", { name: "編輯" }).click();
    const contentArea = page.getByPlaceholder("Markdown 內容...");
    await expect(contentArea).toContainText(secondLine);
  });

  test("single-line note: title equals that line", async ({ page }) => {
    await page.goto("/");
    await navigateTo(page, "閃念");

    const textarea = page.getByPlaceholder(NOTE_CAPTURE_PLACEHOLDER);
    await expect(textarea).toBeVisible({ timeout: 10_000 });

    const singleLine = `SingleLine ${Date.now()}`;
    await textarea.fill(singleLine);

    // Submit via Cmd+Enter (Meta+Enter)
    await textarea.press("Meta+Enter");
    await expect(page.getByText("已新增")).toBeVisible({ timeout: 5_000 });

    // Verify the item appears in the list with the single line as title
    await expect(page.getByText(singleLine)).toBeVisible({ timeout: 5_000 });

    // Open detail and verify title
    await page.getByText(singleLine).click();
    await expect(page.getByPlaceholder("標題", { exact: true })).toHaveValue(singleLine, {
      timeout: 10_000,
    });
  });

  test("todo still uses single-line input with Enter to submit", async ({ page }) => {
    await page.goto("/");
    await navigateTo(page, "進行中");

    // On todo page, input should be visible (not textarea)
    const todoInput = page.getByPlaceholder("新增待辦...");
    await expect(todoInput).toBeVisible({ timeout: 10_000 });

    // Verify it is an <input>, not a <textarea>
    await expect(page.locator('textarea[placeholder="新增待辦..."]')).toHaveCount(0);

    const todoTitle = `Todo ${Date.now()}`;
    await todoInput.fill(todoTitle);

    // Submit via Enter key
    await todoInput.press("Enter");
    await expect(page.getByText("已新增")).toBeVisible({ timeout: 5_000 });

    // Verify todo appears in list
    await expect(page.getByText(todoTitle)).toBeVisible({ timeout: 5_000 });
  });

  test("type switcher changes input between textarea and input", async ({ page }) => {
    await page.goto("/");
    await navigateTo(page, "閃念");

    // On note page: textarea should be visible
    await expect(page.getByPlaceholder(NOTE_CAPTURE_PLACEHOLDER)).toBeVisible({ timeout: 10_000 });

    // Switch to todo
    await page.getByRole("button", { name: "待辦" }).click();
    await expect(page.getByPlaceholder("新增待辦...")).toBeVisible();
    // Note textarea should be gone
    await expect(page.getByPlaceholder(NOTE_CAPTURE_PLACEHOLDER)).not.toBeVisible();

    // Switch to scratch
    await page.getByRole("button", { name: "暫存" }).click();
    await expect(page.getByPlaceholder("暫存筆記...")).toBeVisible();
    // Todo input should be gone
    await expect(page.getByPlaceholder("新增待辦...")).not.toBeVisible();

    // Switch back to note
    await page.getByRole("button", { name: "筆記" }).click();
    await expect(page.getByPlaceholder(NOTE_CAPTURE_PLACEHOLDER)).toBeVisible();
  });

  test("scratch type uses textarea with its own placeholder", async ({ page }) => {
    await page.goto("/");

    // Navigate to scratch page
    await navigateTo(page, "暫存");
    const scratchTextarea = page.getByPlaceholder("暫存筆記...");
    await expect(scratchTextarea).toBeVisible({ timeout: 10_000 });

    const firstLine = `ScratchNote ${Date.now()}`;
    const secondLine = "Extra scratch details";
    await scratchTextarea.fill(`${firstLine}\n${secondLine}`);

    // Submit via Cmd+Enter
    await scratchTextarea.press("Meta+Enter");
    await expect(page.getByText("已新增")).toBeVisible({ timeout: 5_000 });

    // Verify the scratch item appears with the first line as title
    await expect(page.getByText(firstLine)).toBeVisible({ timeout: 5_000 });
  });
});
