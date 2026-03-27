import { test, expect } from "@playwright/test";

import { createItemViaApi } from "./helpers";

/**
 * Helper: get the Monday (ISO week start) of a given date.
 */
function getMonday(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

/** Format Date to YYYY-MM-DD. */
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Shift a Monday string by N weeks. */
function shiftWeek(monday: string, weeks: number): string {
  const [y, m, d] = monday.split("-").map(Number);
  const date = new Date(y!, m! - 1, d! + weeks * 7);
  return toDateStr(date);
}

/** Format month header same as component: "2026年3月" */
function formatMonthHeader(monday: string): string {
  const [y, m] = monday.split("-").map(Number);
  const [, , d] = monday.split("-").map(Number);
  const sundayDate = new Date(y!, m! - 1, d! + 6);
  const sundayMonth = sundayDate.getMonth() + 1;
  const sundayYear = sundayDate.getFullYear();
  if (sundayYear !== y) {
    return `${y}年${m}月—${sundayYear}年${sundayMonth}月`;
  }
  if (sundayMonth !== m) {
    return `${y}年${m}月—${sundayMonth}月`;
  }
  return `${y}年${m}月`;
}

test.describe("WeekView", () => {
  test("週視圖載入與顯示", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "總覽" })).toBeVisible({
      timeout: 10_000,
    });

    // Verify week view section header
    await expect(page.getByText("週檢視", { exact: true })).toBeVisible();

    // Verify the 7-column grid renders (role="grid" with aria-label="週檢視")
    const grid = page.getByRole("grid", { name: "週檢視" });
    await expect(grid).toBeVisible();

    // Verify 7 day cells are rendered
    const cells = grid.getByRole("gridcell");
    await expect(cells).toHaveCount(7);

    // Verify day names are visible (一 through 日)
    const dayNames = ["一", "二", "三", "四", "五", "六", "日"];
    for (const dayName of dayNames) {
      await expect(grid.getByText(dayName, { exact: true }).first()).toBeVisible();
    }

    // Verify the month header is visible
    const thisMonday = getMonday(new Date());
    const expectedHeader = formatMonthHeader(thisMonday);
    await expect(page.getByText(expectedHeader)).toBeVisible();
  });

  test("上下週導航", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "總覽" })).toBeVisible({
      timeout: 10_000,
    });

    // Capture current month header
    const thisMonday = getMonday(new Date());
    const currentHeader = formatMonthHeader(thisMonday);
    await expect(page.getByText(currentHeader)).toBeVisible();

    // Navigate to next week
    await page.getByRole("button", { name: "下一週" }).click();

    // Verify the header changes to next week's month
    const nextMonday = shiftWeek(thisMonday, 1);
    const nextHeader = formatMonthHeader(nextMonday);
    await expect(page.getByText(nextHeader)).toBeVisible();

    // "本週" button should appear when navigated away from current week
    await expect(page.getByRole("button", { name: "本週" })).toBeVisible();

    // Navigate to previous week (back to current week)
    await page.getByRole("button", { name: "上一週" }).click();
    await expect(page.getByText(currentHeader)).toBeVisible();

    // "本週" button should disappear when back at current week
    await expect(page.getByRole("button", { name: "本週" })).toBeHidden();

    // Navigate to previous week (one week before current)
    await page.getByRole("button", { name: "上一週" }).click();
    const prevMonday = shiftWeek(thisMonday, -1);
    const prevHeader = formatMonthHeader(prevMonday);
    await expect(page.getByText(prevHeader)).toBeVisible();

    // Use "本週" button to return to current week
    await page.getByRole("button", { name: "本週" }).click();
    await expect(page.getByText(currentHeader)).toBeVisible();
  });

  test("日期資料正確性 — 待辦依到期日顯示", async ({ page, request }) => {
    // Determine dates in the current week
    const now = new Date();
    const thisMonday = getMonday(now);
    const [y, m, d] = thisMonday.split("-").map(Number);

    // Pick two distinct days: Tuesday and Thursday of this week
    const tuesday = toDateStr(new Date(y!, m! - 1, d! + 1));
    const thursday = toDateStr(new Date(y!, m! - 1, d! + 3));

    const ts = Date.now();
    const tuesdayTitle = `週二待辦-${ts}-tue`;
    const thursdayTitle = `週四待辦-${ts}-thu`;

    // Create todos with specific due dates
    await createItemViaApi(request, {
      title: tuesdayTitle,
      type: "todo",
      due: tuesday,
    });
    await createItemViaApi(request, {
      title: thursdayTitle,
      type: "todo",
      due: thursday,
    });

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "總覽" })).toBeVisible({
      timeout: 10_000,
    });

    // Verify the grid renders
    const grid = page.getByRole("grid", { name: "週檢視" });
    await expect(grid).toBeVisible();

    // Scope assertions to the week view detail panel (border rounded-lg p-3)
    // This avoids matching items in other dashboard sections like "最近活動"
    const weekSection = page.locator("section", { has: grid });

    // Click Tuesday cell (index 1, 0-based) to see detail
    const cells = grid.getByRole("gridcell");
    const tuesdayCell = cells.nth(1);
    await tuesdayCell.click();

    // Verify detail panel shows the Tuesday todo (scoped to week view section)
    const detailPanel = weekSection.locator(".border.rounded-lg");
    await expect(detailPanel.getByText(tuesdayTitle)).toBeVisible({ timeout: 5_000 });
    // The "待辦" section header should be visible
    await expect(detailPanel.getByText(/待辦 \(\d+\)/)).toBeVisible();

    // Click Thursday cell (index 3) to switch
    const thursdayCell = cells.nth(3);
    await thursdayCell.click();

    // Verify detail panel shows the Thursday todo
    await expect(detailPanel.getByText(thursdayTitle)).toBeVisible({ timeout: 5_000 });

    // Tuesday's todo should no longer be in the detail panel
    await expect(detailPanel.getByText(tuesdayTitle)).toBeHidden();
  });

  test("空週狀態 — 無活動天顯示空訊息", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "總覽" })).toBeVisible({
      timeout: 10_000,
    });

    // Navigate far into the future where there's certainly no data
    const nextBtn = page.getByRole("button", { name: "下一週" });
    for (let i = 0; i < 10; i++) {
      await nextBtn.click();
    }

    // Wait for the grid to stabilize after repeated navigation
    const grid = page.getByRole("grid", { name: "週檢視" });
    await expect(grid).toBeVisible();
    // Ensure the last API call has settled by waiting for cells to render
    const cells = grid.getByRole("gridcell");
    await expect(cells).toHaveCount(7);

    await cells.first().click();

    await expect(page.getByText("這天沒有活動")).toBeVisible({ timeout: 5_000 });
  });

  test("點擊日期顯示詳情面板", async ({ page, request }) => {
    // Create a todo due today so we know today's cell has data
    const now = new Date();
    const today = toDateStr(now);
    const todoTitle = `今日詳情測試-${Date.now()}`;

    await createItemViaApi(request, {
      title: todoTitle,
      type: "todo",
      due: today,
    });

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "總覽" })).toBeVisible({
      timeout: 10_000,
    });

    const grid = page.getByRole("grid", { name: "週檢視" });
    await expect(grid).toBeVisible();

    // Scope to week view section to avoid matching items in other dashboard sections
    const weekSection = page.locator("section", { has: grid });
    const detailPanel = weekSection.locator(".border.rounded-lg");

    // Find today's cell — it's at a specific index based on day of week
    // Monday=0, Tuesday=1, ..., Sunday=6
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const gridIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Convert to Mon-based

    const cells = grid.getByRole("gridcell");
    const todayCell = cells.nth(gridIndex);
    await todayCell.click();

    // Verify detail panel opens with the todo (scoped to week view)
    await expect(detailPanel.getByText(todoTitle)).toBeVisible({ timeout: 5_000 });

    // Verify section headers in detail panel
    await expect(detailPanel.getByText(/待辦 \(\d+\)/)).toBeVisible();

    // Click the same cell again to deselect (toggle behavior)
    await todayCell.click();

    // Detail panel should close
    await expect(detailPanel).toBeHidden();
  });
});
