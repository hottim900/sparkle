import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";

import { createCategoryViaApi, createItemViaApi, updateSettingsViaApi } from "./helpers";
import { AUTH_TOKEN } from "../playwright.config";

const PORT = process.env.PORT || 3456;
const API_BASE = `http://localhost:${PORT}/api`;
const VAULT_PATH = "/tmp/e2e-dashboard-vault-merge";

type Req = Parameters<Parameters<typeof test>[1]>[0]["request"];

async function enableObsidian(request: Req) {
  mkdirSync(VAULT_PATH, { recursive: true });
  await updateSettingsViaApi(request, {
    obsidian_enabled: "true",
    obsidian_vault_path: VAULT_PATH,
    obsidian_inbox_folder: "0_Inbox",
    obsidian_export_mode: "overwrite",
  });
}

async function exportItem(request: Req, id: string) {
  const res = await request.post(`${API_BASE}/items/${id}/export`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  if (!res.ok()) {
    throw new Error(`export failed: ${res.status()} ${await res.text()}`);
  }
}

async function getStats(request: Req): Promise<{
  exported_this_week: number;
  exported_this_month: number;
}> {
  const res = await request.get(`${API_BASE}/stats`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  return res.json();
}

async function getCategoryDist(
  request: Req,
): Promise<{ distribution: Array<{ category_id: string | null; count: number }> }> {
  const res = await request.get(`${API_BASE}/stats/category-distribution`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
  });
  return res.json();
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

  test("stats exported_this_week/month increments after export", async ({ request }) => {
    await enableObsidian(request);

    const before = await getStats(request);

    const item = await createItemViaApi(request, {
      title: `stats-export-${Date.now()}`,
      type: "note",
      status: "permanent",
      content: "content",
    });
    await exportItem(request, item.id);

    const after = await getStats(request);
    expect(after.exported_this_week).toBeGreaterThanOrEqual(before.exported_this_week + 1);
    expect(after.exported_this_month).toBeGreaterThanOrEqual(before.exported_this_month + 1);
  });

  test("category distribution counts include vault rows", async ({ request }) => {
    await enableObsidian(request);

    const catName = `vault-cat-${Date.now()}`;
    const cat = await createCategoryViaApi(request, { name: catName, color: "#abcdef" });

    const item = await createItemViaApi(request, {
      title: `vault-cat-item-${Date.now()}`,
      type: "note",
      status: "permanent",
      content: "content",
      category_id: cat.id,
    });
    await exportItem(request, item.id);

    const dist = await getCategoryDist(request);
    const bucket = dist.distribution.find((d) => d.category_id === cat.id);
    expect(
      bucket,
      `category ${cat.id} should appear in distribution after vault export`,
    ).toBeDefined();
    expect(bucket!.count).toBeGreaterThanOrEqual(1);
  });

  test("week view shows exported note in the Wed cell for its exported_at day", async ({
    page,
    request,
  }) => {
    await enableObsidian(request);

    // Create + export a note. exported_at is written at export time (today's local
    // date in the running container), so the matching weekday cell depends on now().
    const title = `week-vault-${Date.now()}`;
    const item = await createItemViaApi(request, {
      title,
      type: "note",
      status: "permanent",
      content: "content",
    });
    await exportItem(request, item.id);

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "總覽" })).toBeVisible({ timeout: 10_000 });

    const grid = page.getByRole("grid", { name: "週檢視" });
    await expect(grid).toBeVisible();

    // Today's cell is at Monday-indexed position. Sunday = JS day 0 → position 6.
    const dayOfWeek = new Date().getDay();
    const gridIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const todayCell = grid.getByRole("gridcell").nth(gridIndex);
    await todayCell.click();

    const weekSection = page.locator("section", { has: grid });
    const detailPanel = weekSection.locator(".border.rounded-lg");

    // Exported notes live under 活躍筆記 (notes_modified bucket).
    await expect(detailPanel.getByText(title)).toBeVisible({ timeout: 5_000 });
  });

  test("/notes/exported redirects to /vault (guards the route deletion)", async ({ page }) => {
    await page.goto("/notes/exported");
    await page.waitForURL((url) => url.pathname === "/vault", { timeout: 5_000 });
    await expect(page).toHaveURL(/\/vault/);
  });
});
