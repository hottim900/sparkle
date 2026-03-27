import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";

import { AUTH_TOKEN } from "../playwright.config";

const PORT = process.env.PORT || 3456;
const API_BASE = `http://localhost:${PORT}/api`;
const VAULT_PATH = "/tmp/e2e-settings-vault";

test.describe("Settings", () => {
  test("loads settings page with all sections", async ({ page }) => {
    await page.goto("/");

    // Navigate to settings
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();

    // Verify page heading (lazy-loaded)
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Verify section headings
    await expect(page.getByRole("heading", { name: "Obsidian 匯出" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Obsidian Daily Note" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard 設定" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "LINE 每日簡報" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "一般" })).toBeVisible();

    // Verify key elements within sections
    await expect(page.getByText("啟用 Obsidian 匯出", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "匯出資料" })).toBeVisible();
  });

  test("toggles theme between light and dark", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });

    const html = page.locator("html");
    const initialClass = (await html.getAttribute("class")) ?? "";
    const isInitiallyDark = initialClass.includes("dark");

    // Click theme toggle
    const themeButton = page.getByRole("button", {
      name: isInitiallyDark ? "淺色模式" : "深色模式",
    });
    await themeButton.click();

    // Verify class changed
    if (isInitiallyDark) {
      await expect(html).not.toHaveClass(/dark/);
    } else {
      await expect(html).toHaveClass(/dark/);
    }

    // Toggle back
    const toggledButton = page.getByRole("button", {
      name: isInitiallyDark ? "深色模式" : "淺色模式",
    });
    await toggledButton.click();

    // Verify reverted
    if (isInitiallyDark) {
      await expect(html).toHaveClass(/dark/);
    } else {
      await expect(html).not.toHaveClass(/dark/);
    }
  });

  test("exports data as JSON download", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Set up download listener before clicking
    const downloadPromise = page.waitForEvent("download");

    // Click export button
    await page.getByRole("button", { name: "匯出資料" }).click();

    // Verify download triggered
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^sparkle-backup-\d{4}-\d{2}-\d{2}\.json$/);

    // Verify toast
    await expect(page.getByText(/已匯出 \d+ 筆資料/)).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Settings - Obsidian", () => {
  test.beforeAll(() => {
    mkdirSync(VAULT_PATH, { recursive: true });
  });

  test.afterAll(() => {
    rmSync(VAULT_PATH, { recursive: true, force: true });
  });

  test("toggles Obsidian enable/disable and saves", async ({ page, request }) => {
    // Ensure Obsidian starts disabled
    await request.put(`${API_BASE}/settings`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      data: { obsidian_enabled: "false" },
    });

    await page.goto("/");
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Enable Obsidian
    await page.getByRole("button", { name: "已停用" }).first().click();

    // Fill vault path (required for save to succeed)
    await page.getByPlaceholder("/home/user/obsidian-vault").fill(VAULT_PATH);

    // Save Obsidian settings (first "儲存設定" button)
    const saveResponsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/settings") && r.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "儲存設定", exact: true }).first().click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBeTruthy();

    await expect(page.getByText("設定已儲存")).toBeVisible({ timeout: 5_000 });

    // Reload and verify persisted
    await page.reload();
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    // Obsidian should show "已啟用" (first toggle)
    await expect(page.getByRole("button", { name: "已啟用" }).first()).toBeVisible();

    // Disable Obsidian again
    await page.getByRole("button", { name: "已啟用" }).first().click();
    const disableResponsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/settings") && r.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "儲存設定", exact: true }).first().click();
    const disableResponse = await disableResponsePromise;
    expect(disableResponse.ok()).toBeTruthy();

    await expect(page.getByText("設定已儲存")).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Settings - Dashboard", () => {
  test("changes recent_days and stale_days and saves", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Scroll to Dashboard section
    await page.getByRole("heading", { name: "Dashboard 設定" }).scrollIntoViewIfNeeded();

    // Change recent_days: find the input by its label
    const recentDaysInput = page
      .locator("section")
      .filter({ hasText: "最近新增天數" })
      .getByRole("spinbutton")
      .first();
    await recentDaysInput.fill("10");

    // Change stale_days
    const staleDaysInput = page
      .locator("section")
      .filter({ hasText: "過期筆記天數" })
      .getByRole("spinbutton")
      .last();
    await staleDaysInput.fill("21");

    // Save Dashboard settings
    const saveResponsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/settings") && r.request().method() === "PUT",
    );
    // Dashboard save button is in the section with "Dashboard 設定"
    const dashboardSection = page.locator("section").filter({ hasText: "Dashboard 設定" });
    await dashboardSection.getByRole("button", { name: "儲存設定", exact: true }).click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBeTruthy();

    await expect(page.getByText("Dashboard 設定已儲存")).toBeVisible({ timeout: 5_000 });

    // Reload and verify persisted
    await page.reload();
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(recentDaysInput).toHaveValue("10");
    await expect(staleDaysInput).toHaveValue("21");

    // Restore defaults
    await recentDaysInput.fill("7");
    await staleDaysInput.fill("14");
    const restoreResponsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/settings") && r.request().method() === "PUT",
    );
    await dashboardSection.getByRole("button", { name: "儲存設定", exact: true }).click();
    await restoreResponsePromise;
  });
});

test.describe("Settings - LINE Brief", () => {
  test("toggles LINE brief enable/disable, changes time, and saves", async ({ page, request }) => {
    // Ensure LINE brief starts enabled with known time via API
    await request.put(`${API_BASE}/settings`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      data: { line_brief_enabled: "true", line_brief_time: "21:00" },
    });

    await page.goto("/");
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Scroll to LINE Brief section
    const lineBriefSection = page.locator("section").filter({ hasText: "LINE 每日簡報" });
    await lineBriefSection.scrollIntoViewIfNeeded();

    // Verify starts as enabled
    const lineBriefToggle = lineBriefSection.getByRole("button", { name: /已啟用|已停用/ });
    await expect(lineBriefToggle).toHaveText("已啟用");

    // Change time first (while still enabled so input is not disabled)
    const timeInput = lineBriefSection.locator('input[type="time"]');
    await timeInput.fill("08:30");

    // Disable LINE brief
    await lineBriefToggle.click();
    await expect(lineBriefToggle).toHaveText("已停用");

    // Save LINE Brief settings
    const saveResponsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/settings") && r.request().method() === "PUT",
    );
    await lineBriefSection.getByRole("button", { name: "儲存設定", exact: true }).click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBeTruthy();

    await expect(page.getByText("LINE 簡報設定已儲存")).toBeVisible({ timeout: 5_000 });

    // Reload and verify persisted
    await page.reload();
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(lineBriefToggle).toHaveText("已停用");
    await expect(timeInput).toHaveValue("08:30");

    // Restore defaults via API
    await request.put(`${API_BASE}/settings`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      data: { line_brief_enabled: "true", line_brief_time: "21:00" },
    });
  });

  test("manual send button triggers LINE brief", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });

    const lineBriefSection = page.locator("section").filter({ hasText: "LINE 每日簡報" });
    await lineBriefSection.scrollIntoViewIfNeeded();

    // Click "立即發送" button
    const sendButton = lineBriefSection.getByRole("button", { name: "立即發送" });
    await expect(sendButton).toBeVisible();

    // The send will likely fail or skip (no LINE config in E2E), but verify the API call fires
    const sendResponsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/line-brief/send") && r.request().method() === "POST",
    );
    await sendButton.click();
    const sendResponse = await sendResponsePromise;
    // Just verify the API was called (status may be 200 with skipped or error)
    expect(sendResponse.status()).toBeLessThan(500);
  });
});

test.describe("Settings - Daily Note", () => {
  test.beforeAll(() => {
    mkdirSync(VAULT_PATH, { recursive: true });
  });

  test.afterAll(() => {
    rmSync(VAULT_PATH, { recursive: true, force: true });
  });

  test("shows warning when Obsidian is not enabled", async ({ page, request }) => {
    // Ensure Obsidian is disabled
    await request.put(`${API_BASE}/settings`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      data: { obsidian_enabled: "false" },
    });

    await page.goto("/");
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Verify warning text is shown
    await expect(page.getByText("請先在上方啟用 Obsidian 匯出")).toBeVisible();

    // Daily note toggle should be disabled
    const dailyNoteSection = page.locator("section").filter({ hasText: "Obsidian Daily Note" });
    const dailyNoteToggle = dailyNoteSection.getByRole("button", { name: /已啟用|已停用/ });
    await expect(dailyNoteToggle).toBeDisabled();
  });

  test("changes mode, time, folder and saves", async ({ page, request }) => {
    // Enable Obsidian first via API
    await request.put(`${API_BASE}/settings`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      data: {
        obsidian_enabled: "true",
        obsidian_vault_path: VAULT_PATH,
        daily_note_enabled: "false",
        daily_note_mode: "subfolder",
        daily_note_time: "23:00",
        obsidian_daily_folder: "Daily",
      },
    });

    await page.goto("/");
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });

    const dailyNoteSection = page.locator("section").filter({ hasText: "Obsidian Daily Note" });
    await dailyNoteSection.scrollIntoViewIfNeeded();

    // Enable daily note (use regex to find toggle regardless of current state)
    const dailyNoteToggle = dailyNoteSection.getByRole("button", { name: /已啟用|已停用/ });
    await expect(dailyNoteToggle).toHaveText("已停用");
    await dailyNoteToggle.click();
    await expect(dailyNoteToggle).toHaveText("已啟用");

    // Change folder
    const folderInput = dailyNoteSection.getByPlaceholder("Daily");
    await folderInput.fill("Journal/Notes");

    // Change time
    const timeInput = dailyNoteSection.locator('input[type="time"]');
    await timeInput.fill("07:00");

    // Change mode to append via Radix Select
    const modeSelectTrigger = dailyNoteSection.locator('[role="combobox"]');
    await modeSelectTrigger.click();
    await page.getByRole("option", { name: "追加模式" }).click();

    // Save Daily Note settings
    const saveResponsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/settings") && r.request().method() === "PUT",
    );
    await dailyNoteSection.getByRole("button", { name: "儲存設定", exact: true }).click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBeTruthy();

    await expect(page.getByText("Daily Note 設定已儲存")).toBeVisible({ timeout: 5_000 });

    // Reload and verify persisted
    await page.reload();
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });

    await expect(folderInput).toHaveValue("Journal/Notes");
    await expect(timeInput).toHaveValue("07:00");
    // Verify mode is "追加模式"
    await expect(dailyNoteSection.locator('[role="combobox"]')).toHaveText("追加模式");

    // Restore defaults
    await request.put(`${API_BASE}/settings`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      data: {
        obsidian_enabled: "false",
        daily_note_enabled: "false",
        daily_note_mode: "subfolder",
        daily_note_time: "23:00",
        obsidian_daily_folder: "Daily",
      },
    });
  });

  test("generate button triggers daily note generation", async ({ page, request }) => {
    // Enable Obsidian via API
    await request.put(`${API_BASE}/settings`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      data: {
        obsidian_enabled: "true",
        obsidian_vault_path: VAULT_PATH,
      },
    });

    await page.goto("/");
    await page.getByTestId("sidebar").getByRole("link", { name: "設定" }).click();
    await expect(page.getByRole("heading", { name: "設定", exact: true })).toBeVisible({
      timeout: 10_000,
    });

    const dailyNoteSection = page.locator("section").filter({ hasText: "Obsidian Daily Note" });
    await dailyNoteSection.scrollIntoViewIfNeeded();

    // Click "立即生成" button
    const generateButton = dailyNoteSection.getByRole("button", { name: "立即生成" });
    await expect(generateButton).toBeVisible();
    await expect(generateButton).toBeEnabled();

    const generateResponsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/daily-note/generate") && r.request().method() === "POST",
    );
    await generateButton.click();
    const generateResponse = await generateResponsePromise;
    // Verify the API was called (may succeed or show "skipped" for no activity)
    expect(generateResponse.status()).toBeLessThan(500);

    // Restore defaults
    await request.put(`${API_BASE}/settings`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      data: { obsidian_enabled: "false" },
    });
  });
});
