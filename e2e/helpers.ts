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
    category_id?: string | null;
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
  await page.getByTestId("sidebar").getByRole("link", { name: label }).click();
}

/**
 * Wait for auto-save to complete (status indicator shows "已儲存").
 */
export async function waitForSave(page: Page) {
  await page.getByText("已儲存").waitFor({ timeout: 5_000 });
}

/** Note quick-capture placeholder (textarea, multi-line) */
export const NOTE_CAPTURE_PLACEHOLDER = "打下你的想法... 第一行會成為標題";

/**
 * Create a note via quick capture UI.
 */
export async function quickCaptureNote(page: Page, title: string) {
  await page.getByPlaceholder(NOTE_CAPTURE_PLACEHOLDER).fill(title);
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

/**
 * Create a share for an item via API.
 */
export async function createShareViaApi(
  request: APIRequestContext,
  itemId: string,
  visibility: "unlisted" | "public" = "unlisted",
) {
  const response = await request.post(`${API_BASE}/items/${itemId}/share`, {
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    data: { visibility },
  });
  return response.json();
}

/**
 * Create a category via the REST API (bypasses UI for fast setup).
 */
export async function createCategoryViaApi(
  request: APIRequestContext,
  data: { name: string; color?: string },
) {
  const response = await request.post(`${API_BASE}/categories`, {
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    data,
  });
  return response.json();
}

/**
 * Update settings via the REST API (bypasses UI for fast setup/teardown).
 */
export async function updateSettingsViaApi(
  request: APIRequestContext,
  data: Record<string, string>,
) {
  const response = await request.put(`${API_BASE}/settings`, {
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    data,
  });
  return response;
}

/**
 * Navigate to the Settings page and wait for it to load.
 */
export async function navigateToSettings(page: Page) {
  await page.goto("/");
  await navigateTo(page, "設定");
  await page
    .getByRole("heading", { name: "設定", exact: true })
    .waitFor({ state: "visible", timeout: 10_000 });
}

/**
 * Setup PIN and unlock private space via API.
 * Returns the session token for subsequent private API calls.
 */
export async function setupPrivatePin(request: APIRequestContext, pin = "123456"): Promise<string> {
  const headers = {
    Authorization: `Bearer ${AUTH_TOKEN}`,
    "Content-Type": "application/json",
  };
  await request.post(`${API_BASE}/private/setup`, { headers, data: { pin } });
  const unlockRes = await request.post(`${API_BASE}/private/unlock`, {
    headers,
    data: { pin },
  });
  const body = await unlockRes.json();
  return body.token;
}

/**
 * Create a private item via API (requires session token from setupPrivatePin).
 */
export async function createPrivateItemViaApi(
  request: APIRequestContext,
  privateToken: string,
  data: {
    title?: string;
    type?: "note" | "todo" | "scratch";
    content?: string;
  },
) {
  const response = await request.post(`${API_BASE}/private/items`, {
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "Content-Type": "application/json",
      "X-Private-Token": privateToken,
    },
    data,
  });
  return response.json();
}
