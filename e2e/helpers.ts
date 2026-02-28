import { type Page, type APIRequestContext } from "@playwright/test";

import { AUTH_TOKEN } from "../playwright.config";

const PORT = process.env.PORT || 3456;
const API_BASE = `http://localhost:${PORT}/api`;

/**
 * Create an item via the REST API (bypasses UI for fast setup).
 */
export async function createItemViaApi(
  request: APIRequestContext,
  data: {
    title: string;
    type?: "note" | "todo" | "scratch";
    status?: string;
    content?: string;
    priority?: string | null;
    due?: string | null;
    tags?: string[];
    linked_note_id?: string | null;
  },
) {
  const response = await request.post(`${API_BASE}/items`, {
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    data,
  });
  return response.json();
}

/**
 * Create multiple fleeting notes via API for triage setup (parallel).
 */
export async function createFleetingNotes(
  request: APIRequestContext,
  count: number,
  prefix: string,
) {
  const promises = Array.from({ length: count }, (_, i) =>
    createItemViaApi(request, {
      title: `${prefix} ${i + 1}`,
      type: "note",
    }),
  );
  return Promise.all(promises);
}

/**
 * Interact with a Radix Select dropdown.
 */
export async function selectRadixOption(
  page: Page,
  triggerLocator: ReturnType<Page["locator"]>,
  targetOptionText: string,
) {
  await triggerLocator.click();
  await page.getByRole("option", { name: targetOptionText }).click();
}

/**
 * Navigate to a sidebar view by clicking the corresponding button.
 */
export async function navigateTo(page: Page, label: string) {
  await page.getByRole("button", { name: label }).click();
}

/**
 * Wait for auto-save to complete (status indicator shows "已儲存").
 */
export async function waitForSave(page: Page) {
  await page.getByText("已儲存").waitFor({ timeout: 5_000 });
}

/**
 * Create a note via quick capture UI.
 */
export async function quickCaptureNote(page: Page, title: string) {
  await page.getByPlaceholder("快速記錄...").fill(title);
  await page.locator("button[type='submit']").click();
  await page.getByText("已新增").waitFor({ timeout: 5_000 });
}

/**
 * Create a todo via quick capture UI.
 */
export async function quickCaptureTodo(page: Page, title: string) {
  await page.getByPlaceholder("新增待辦...").fill(title);
  await page.locator("button[type='submit']").click();
  await page.getByText("已新增").waitFor({ timeout: 5_000 });
}
