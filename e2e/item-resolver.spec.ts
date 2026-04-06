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

  test("vault sparkle badge navigates through resolver to correct list", async ({
    page,
    request,
  }) => {
    // Enable Obsidian + export a note so vault has a sparkle item
    await request.put(`http://localhost:${PORT}/api/settings`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      data: {
        obsidian_enabled: "true",
        obsidian_vault_path: "/tmp/e2e-resolver-vault",
        obsidian_inbox_folder: "0_Inbox",
        obsidian_export_mode: "overwrite",
      },
    });

    const title = `vault-resolve-${Date.now()}`;
    const item = await createItemViaApi(request, {
      title,
      type: "note",
      status: "permanent",
      content: "Test content for vault resolver",
    });

    // Export the note
    const exportRes = await request.post(`http://localhost:${PORT}/api/items/${item.id}/export`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(exportRes.ok()).toBeTruthy();

    // Go to vault page
    await page.goto("/");
    await navigateTo(page, "Vault 瀏覽");
    await expect(page.getByRole("heading", { name: "Vault" })).toBeVisible({ timeout: 10_000 });

    // Find the exported note in vault and click "在 Sparkle 中查看"
    // The vault file list should show the exported note
    await page.getByText(title).click();
    await expect(page.getByText("來自 Sparkle")).toBeVisible({ timeout: 10_000 });
    await page.getByText("在 Sparkle 中查看").click();

    // Should navigate through /item/:id resolver to standalone exported view
    await expect(page.getByText("已匯出至 Obsidian")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("回到 Vault")).toBeVisible();
  });
});
