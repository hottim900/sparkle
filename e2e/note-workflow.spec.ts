import { test, expect } from "@playwright/test";
import {
  createFleetingNotes,
  navigateTo,
  selectRadixOption,
  quickCaptureNote,
  waitForSave,
} from "./helpers";

test.describe("Note Triage Workflow", () => {
  // Create 14 fleeting notes to exceed >10 threshold for triage
  const prefix = `Triage ${Date.now()}`;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(60_000);
    await createFleetingNotes(request, 14, prefix);
  });

  test("triage — develop a fleeting note", async ({ page }) => {
    await page.goto("/");

    // Navigate to fleeting notes
    await navigateTo(page, "閃念");
    await expect(page.getByPlaceholder("快速記錄...")).toBeVisible({ timeout: 10_000 });

    // Click "整理" tab to enter triage mode
    await page.getByRole("button", { name: "整理", exact: true }).click();

    // Triage card should be visible with remaining count
    await expect(page.getByText(/剩餘 \d+ 項/)).toBeVisible({ timeout: 10_000 });

    // Click "發展" (exact to avoid matching sidebar "發展中")
    await page.getByRole("button", { name: "發展", exact: true }).click();

    // Verify toast
    await expect(page.getByText("已設為發展中")).toBeVisible({ timeout: 5_000 });
  });

  test("triage — archive a fleeting note", async ({ page }) => {
    await page.goto("/");

    // Navigate to fleeting notes → triage
    await navigateTo(page, "閃念");
    await expect(page.getByPlaceholder("快速記錄...")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "整理", exact: true }).click();
    await expect(page.getByText(/剩餘 \d+ 項/)).toBeVisible({ timeout: 10_000 });

    // Click "封存" (exact to avoid matching sidebar "已封存")
    await page.getByRole("button", { name: "封存", exact: true }).click();

    // Verify toast
    await expect(page.getByText("已封存")).toBeVisible({ timeout: 5_000 });
  });

  test("triage — skip/preserve moves to next note", async ({ page }) => {
    await page.goto("/");

    // Navigate to fleeting notes → triage
    await navigateTo(page, "閃念");
    await expect(page.getByPlaceholder("快速記錄...")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "整理", exact: true }).click();
    await expect(page.getByText(/剩餘 \d+ 項/)).toBeVisible({ timeout: 10_000 });

    // Capture current card title
    const cardTitle = await page.locator("h2.text-lg.font-semibold").textContent();

    // Click "保留"
    await page.getByRole("button", { name: "保留", exact: true }).click();

    // Verify the card has changed (different title)
    await expect(page.locator("h2.text-lg.font-semibold")).not.toHaveText(cardTitle!, {
      timeout: 5_000,
    });
  });
});

test.describe("Note Maturity Progression", () => {
  test("advance note from fleeting → developing → permanent via status dropdown", async ({
    page,
  }) => {
    await page.goto("/");

    // Navigate to fleeting notes
    await navigateTo(page, "閃念");
    await expect(page.getByPlaceholder("快速記錄...")).toBeVisible({ timeout: 10_000 });

    // Create a note
    const noteTitle = `Maturity ${Date.now()}`;
    await quickCaptureNote(page, noteTitle);

    // Click the note to open detail
    await page.getByText(noteTitle).first().click();
    await expect(page.locator(`input[value="${noteTitle}"]`)).toBeVisible({ timeout: 10_000 });

    // Status select shows "閃念" — change to "發展中"
    const fleetingTrigger = page.locator('button[role="combobox"]').filter({ hasText: "閃念" });
    await expect(fleetingTrigger).toBeVisible();
    await selectRadixOption(page, fleetingTrigger, "發展中");
    await waitForSave(page);

    // Now status shows "發展中" — change to "永久筆記"
    const developingTrigger = page.locator('button[role="combobox"]').filter({ hasText: "發展中" });
    await expect(developingTrigger).toBeVisible();
    await selectRadixOption(page, developingTrigger, "永久筆記");
    await waitForSave(page);

    // Verify status now shows "永久筆記"
    await expect(
      page.locator('button[role="combobox"]').filter({ hasText: "永久筆記" }),
    ).toBeVisible();
  });
});
