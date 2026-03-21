import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";

import { createItemViaApi, navigateTo } from "./helpers";
import { AUTH_TOKEN } from "../playwright.config";

const PORT = process.env.PORT || 3456;
const VAULT_PATH = "/tmp/e2e-obsidian-vault";

test.describe("Obsidian Export", () => {
  test.beforeAll(() => {
    // Ensure vault directory exists (server validates writable path)
    mkdirSync(VAULT_PATH, { recursive: true });
  });

  test.afterAll(() => {
    rmSync(VAULT_PATH, { recursive: true, force: true });
  });

  test("configures Obsidian export settings", async ({ page }) => {
    await page.goto("/");

    // Navigate to settings
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Wait for settings to load, then enable Obsidian export toggle
    await expect(page.getByRole("button", { name: "已停用" })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "已停用" }).click();

    // Fill vault path
    const vaultPathInput = page.getByPlaceholder("/home/user/obsidian-vault");
    await vaultPathInput.fill(VAULT_PATH);

    // Save settings (first button is Obsidian settings, second is Dashboard settings)
    await page.getByRole("button", { name: "儲存設定" }).first().click();
    await expect(page.getByText("設定已儲存")).toBeVisible({ timeout: 5_000 });

    // Reload and verify persistence
    await page.reload();
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: "已啟用" })).toBeVisible();
    await expect(vaultPathInput).toHaveValue(VAULT_PATH);
  });

  test("exports permanent note to Obsidian", async ({ page, request }) => {
    // Enable Obsidian via API (values must be strings per settings schema)
    const settingsRes = await request.put(`http://localhost:${PORT}/api/settings`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      data: {
        obsidian_enabled: "true",
        obsidian_vault_path: VAULT_PATH,
        obsidian_inbox_folder: "0_Inbox",
        obsidian_export_mode: "overwrite",
      },
    });
    expect(settingsRes.ok()).toBeTruthy();

    // Create permanent note
    const title = `export-test-${Date.now()}`;
    await createItemViaApi(request, { title, type: "note", status: "permanent" });

    await page.goto("/");
    await navigateTo(page, "永久筆記");
    await page.getByText(title).click();
    await expect(page.getByPlaceholder("標題")).toBeVisible({ timeout: 10_000 });

    // Click export button
    await page.getByRole("button", { name: "匯出到 Obsidian" }).click();

    // Verify toast confirms export
    await expect(page.getByText("已匯出到 Obsidian")).toBeVisible({ timeout: 5_000 });

    // Verify item no longer appears in permanent notes list (moved to exported)
    await navigateTo(page, "永久筆記");
    await expect(page.getByText(title)).not.toBeVisible({ timeout: 5_000 });
  });
});
