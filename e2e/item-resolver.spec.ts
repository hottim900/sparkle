import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { createItemViaApi, navigateTo } from "./helpers";
import { AUTH_TOKEN } from "../playwright.config";

const PORT = process.env.PORT || 3456;
const VAULT_PATH = "/tmp/e2e-resolver-vault";

test.describe("Item Resolver (/item/:id)", () => {
  test.beforeAll(() => {
    mkdirSync(VAULT_PATH, { recursive: true });
  });

  test.afterAll(() => {
    rmSync(VAULT_PATH, { recursive: true, force: true });
  });

  test("resolves fleeting note to /notes/fleeting with item selected", async ({
    page,
    request,
  }) => {
    const title = `resolver-fleeting-${Date.now()}`;
    const item = await createItemViaApi(request, {
      title,
      type: "note",
      status: "fleeting",
    });

    await page.goto(`/item/${item.id}`);

    // Should redirect to /notes/fleeting with item selected
    await expect(page).toHaveURL(/\/notes\/fleeting/);
    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });
  });

  test("shows toast and redirects to dashboard for nonexistent item", async ({ page }) => {
    await page.goto("/item/nonexistent-id-that-does-not-exist");

    // Should show toast and redirect to dashboard
    await expect(page.getByText("找不到此項目")).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("/all?item=X backward compat redirects to correct list", async ({ page, request }) => {
    const title = `compat-test-${Date.now()}`;
    const item = await createItemViaApi(request, {
      title,
      type: "todo",
      status: "active",
    });

    await page.goto(`/all?item=${item.id}`);

    // Should redirect through /item/:id to /todos with item selected
    await expect(page).toHaveURL(/\/todos/);
    await expect(page.getByText(title)).toBeVisible({ timeout: 10_000 });
  });

  test("/all without params redirects to dashboard", async ({ page }) => {
    await page.goto("/all");

    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("exported item renders standalone view with back-to-vault link", async ({
    page,
    request,
  }) => {
    // Enable Obsidian and export a note via API
    await request.put(`http://localhost:${PORT}/api/settings`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      data: {
        obsidian_enabled: "true",
        obsidian_vault_path: VAULT_PATH,
        obsidian_inbox_folder: "0_Inbox",
        obsidian_export_mode: "overwrite",
      },
    });

    const title = `exported-standalone-${Date.now()}`;
    const item = await createItemViaApi(request, {
      title,
      type: "note",
      status: "permanent",
      content: "# Standalone View Test\n\nThis is exported.",
    });

    const exportRes = await request.post(`http://localhost:${PORT}/api/items/${item.id}/export`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(exportRes.ok()).toBeTruthy();

    // Navigate directly via /item/:id resolver
    await page.goto(`/item/${item.id}`);

    // Exported item should render standalone detail view (not redirect)
    await expect(page.getByText("已匯出至 Obsidian")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("回到 Vault")).toBeVisible();
    await expect(page.locator("h1").filter({ hasText: title })).toBeVisible();

    // Back-to-vault link should navigate to /vault
    await page.getByText("回到 Vault").click();
    await expect(page).toHaveURL(/\/vault/);
  });
});
