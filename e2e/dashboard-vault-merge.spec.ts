import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";

import { createItemViaApi, updateSettingsViaApi } from "./helpers";
import { AUTH_TOKEN } from "../playwright.config";

const PORT = process.env.PORT || 3456;
const API_BASE = `http://localhost:${PORT}/api`;
const VAULT_PATH = "/tmp/e2e-dashboard-vault-merge";

async function enableObsidian(request: Parameters<Parameters<typeof test>[1]>[0]["request"]) {
  mkdirSync(VAULT_PATH, { recursive: true });
  await updateSettingsViaApi(request, {
    obsidian_enabled: "true",
    obsidian_vault_path: VAULT_PATH,
    obsidian_inbox_folder: "0_Inbox",
    obsidian_export_mode: "overwrite",
  });
}

async function exportItem(
  request: Parameters<Parameters<typeof test>[1]>[0]["request"],
  id: string,
) {
  const res = await request.post(`${API_BASE}/items/${id}/export`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  if (!res.ok()) {
    throw new Error(`export failed: ${res.status()} ${await res.text()}`);
  }
}

test.describe("Dashboard — items_vault merge (PR3)", () => {
  test.afterAll(() => {
    rmSync(VAULT_PATH, { recursive: true, force: true });
  });

  test("exported note surfaces in 最近活動 with 匯出 badge", async ({ page, request }) => {
    await enableObsidian(request);

    const title = `vault-dashboard-${Date.now()}`;
    const item = await createItemViaApi(request, {
      title,
      type: "note",
      status: "permanent",
      content: "permanent content ready for export",
    });
    await exportItem(request, item.id);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "總覽" })).toBeVisible({ timeout: 10_000 });

    const recentSection = page
      .locator(".max-w-2xl")
      .getByText("最近活動", { exact: true })
      .locator("xpath=ancestor::div[contains(@class,'border-l-4')]");
    await expect(recentSection.getByText(title)).toBeVisible({ timeout: 5_000 });
    await expect(recentSection.getByText("匯出", { exact: true })).toBeVisible();
  });

  test("clicking an exported row from recent feed navigates to /item/:id", async ({
    page,
    request,
  }) => {
    await enableObsidian(request);

    const title = `vault-dashboard-click-${Date.now()}`;
    const item = await createItemViaApi(request, {
      title,
      type: "note",
      status: "permanent",
      content: "permanent content ready for export",
    });
    await exportItem(request, item.id);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "總覽" })).toBeVisible({ timeout: 10_000 });

    // Click the vault row
    await page.getByRole("button", { name: new RegExp(title) }).click();

    // Universal /item/:id resolver redirects to /vault for vault items.
    // Assert the URL transitions off /dashboard (either /item/... or /vault).
    await page.waitForURL((url) => !url.pathname.startsWith("/dashboard"), {
      timeout: 5_000,
    });
  });
});
