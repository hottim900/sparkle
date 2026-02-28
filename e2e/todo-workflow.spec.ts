import { test, expect } from "@playwright/test";
import {
  createItemViaApi,
  navigateTo,
  selectRadixOption,
  quickCaptureTodo,
  quickCaptureNote,
  waitForSave,
} from "./helpers";

test.describe("Todo Priority and Due Date", () => {
  test("create todo with priority and due date", async ({ page }) => {
    await page.goto("/");

    // Navigate to active todos
    await navigateTo(page, "進行中");
    await expect(page.getByPlaceholder("新增待辦...")).toBeVisible({ timeout: 10_000 });

    // Create a todo
    const todoTitle = `Priority ${Date.now()}`;
    await quickCaptureTodo(page, todoTitle);

    // Open detail
    await page.getByText(todoTitle).first().click();
    await expect(page.locator(`input[value="${todoTitle}"]`)).toBeVisible({ timeout: 10_000 });

    // Priority select shows "無" (default for new todo) — change to "高"
    const priorityTrigger = page.locator('button[role="combobox"]').filter({ hasText: "無" });
    await expect(priorityTrigger).toBeVisible();
    await selectRadixOption(page, priorityTrigger, "高");
    await waitForSave(page);

    // Set due date (tomorrow)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDateStr = tomorrow.toISOString().split("T")[0];
    await page.locator('input[type="date"]').fill(dueDateStr);
    await waitForSave(page);

    // Verify priority shows "高"
    await expect(page.locator('button[role="combobox"]').filter({ hasText: "高" })).toBeVisible();

    // Verify due date persisted
    await expect(page.locator('input[type="date"]')).toHaveValue(dueDateStr);
  });
});

test.describe("Todo Status", () => {
  test("mark todo as done", async ({ page }) => {
    await page.goto("/");

    // Navigate to active todos
    await navigateTo(page, "進行中");
    await expect(page.getByPlaceholder("新增待辦...")).toBeVisible({ timeout: 10_000 });

    // Create a todo
    const todoTitle = `Done ${Date.now()}`;
    await quickCaptureTodo(page, todoTitle);

    // Open detail
    await page.getByText(todoTitle).first().click();
    await expect(page.locator(`input[value="${todoTitle}"]`)).toBeVisible({ timeout: 10_000 });

    // Status select shows "進行中" — change to "已完成"
    const statusTrigger = page.locator('button[role="combobox"]').filter({ hasText: "進行中" });
    await expect(statusTrigger).toBeVisible();
    await selectRadixOption(page, statusTrigger, "已完成");
    await waitForSave(page);

    // Verify status shows "已完成"
    await expect(
      page.locator('button[role="combobox"]').filter({ hasText: "已完成" }),
    ).toBeVisible();
  });
});

test.describe("Linked Todos", () => {
  test("create a linked todo from a note", async ({ page }) => {
    await page.goto("/");

    // Navigate to fleeting notes
    await navigateTo(page, "閃念");
    await expect(page.getByPlaceholder("快速記錄...")).toBeVisible({ timeout: 10_000 });

    // Create a note
    const noteTitle = `LinkedNote ${Date.now()}`;
    await quickCaptureNote(page, noteTitle);

    // Open detail
    await page.getByText(noteTitle).first().click();
    await expect(page.locator(`input[value="${noteTitle}"]`)).toBeVisible({ timeout: 10_000 });

    // Click "建立追蹤待辦" button in header
    await page.getByRole("button", { name: "建立追蹤待辦" }).click();

    // Inline form should appear with pre-filled title
    const todoTitleInput = page.getByPlaceholder("待辦標題");
    await expect(todoTitleInput).toBeVisible({ timeout: 5_000 });
    await expect(todoTitleInput).toHaveValue(`處理：${noteTitle}`);

    // Click "建立" to create the linked todo
    await page.getByRole("button", { name: "建立", exact: true }).click();

    // Verify toast
    await expect(page.getByText("已建立關聯待辦")).toBeVisible({ timeout: 5_000 });

    // Verify linked todo appears in "關聯待辦" section
    await expect(page.getByText("關聯待辦", { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(`處理：${noteTitle}`)).toBeVisible();
  });

  test("navigate from linked todo to note", async ({ page, request }) => {
    // Create note and linked todo via API for fast setup
    const noteTitle = `NavNote ${Date.now()}`;
    const noteItem = await createItemViaApi(request, {
      title: noteTitle,
      type: "note",
    });

    const todoTitle = `處理：${noteTitle}`;
    await createItemViaApi(request, {
      title: todoTitle,
      type: "todo",
      linked_note_id: noteItem.id,
    });

    await page.goto("/");

    // Navigate to active todos
    await navigateTo(page, "進行中");
    await expect(page.getByPlaceholder("新增待辦...")).toBeVisible({ timeout: 10_000 });

    // Click the linked todo to open detail
    await page.getByText(todoTitle).first().click();
    await expect(page.locator(`input[value="${todoTitle}"]`)).toBeVisible({ timeout: 10_000 });

    // "關聯筆記" section should show the linked note
    await expect(page.getByText("關聯筆記")).toBeVisible({ timeout: 5_000 });

    // Click the linked note button to navigate
    await page.locator("button").filter({ hasText: noteTitle }).first().click();

    // Verify we navigated to the note detail (title input shows note title)
    await expect(page.locator(`input[value="${noteTitle}"]`)).toBeVisible({ timeout: 10_000 });
  });
});
