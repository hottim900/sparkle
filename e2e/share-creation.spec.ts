import { test, expect } from "@playwright/test";
import { createItemViaApi, createShareViaApi, navigateTo } from "./helpers";

test.use({ permissions: ["clipboard-write", "clipboard-read"] });

test.describe("Share creation workflow", () => {
  test("creates unlisted share from detail panel", async ({ page, request }) => {
    const noteTitle = `Share-Unlisted-${Date.now()}`;
    await createItemViaApi(request, {
      title: noteTitle,
      type: "note",
      status: "permanent",
    });

    await page.goto("/");
    await navigateTo(page, "永久筆記");
    await page.getByText(noteTitle).click();

    // Open share dialog — exact match to avoid matching sidebar "分享管理"
    await page.getByRole("button", { name: "分享", exact: true }).click();
    await expect(page.getByRole("heading", { name: "分享筆記" })).toBeVisible();

    // Create share (default unlisted)
    await page.getByRole("button", { name: "建立分享" }).click();

    // Verify toast
    await expect(page.getByText("已建立分享並複製連結")).toBeVisible({ timeout: 5_000 });

    // Verify unlisted badge in dialog
    await expect(page.getByRole("dialog").getByText("僅限連結").first()).toBeVisible();
  });

  test("creates public share", async ({ page, request }) => {
    const noteTitle = `Share-Public-${Date.now()}`;
    await createItemViaApi(request, {
      title: noteTitle,
      type: "note",
      status: "permanent",
    });

    await page.goto("/");
    await navigateTo(page, "永久筆記");
    await page.getByText(noteTitle).click();

    // Open share dialog
    await page.getByRole("button", { name: "分享", exact: true }).click();
    await expect(page.getByRole("heading", { name: "分享筆記" })).toBeVisible();

    // Change visibility to public
    const visibilityTrigger = page.getByRole("dialog").locator('[data-slot="select-trigger"]');
    await visibilityTrigger.click();
    await page.getByRole("option", { name: /公開/ }).click();

    // Create share
    await page.getByRole("button", { name: "建立分享" }).click();

    // Verify toast
    await expect(page.getByText("已建立分享並複製連結")).toBeVisible({ timeout: 5_000 });

    // Verify public badge in dialog
    const publicBadges = page.getByRole("dialog").locator('[data-slot="badge"]', { hasText: "公開" });
    await expect(publicBadges.first()).toBeVisible();
  });

  test("copies share link", async ({ page, request }) => {
    const noteTitle = `Share-Copy-${Date.now()}`;
    const note = await createItemViaApi(request, {
      title: noteTitle,
      type: "note",
      status: "permanent",
    });
    await createShareViaApi(request, note.id, "unlisted");

    await page.goto("/");
    await navigateTo(page, "永久筆記");
    await page.getByText(noteTitle).click();

    // Button text changes to "已分享" when share exists
    await page.getByRole("button", { name: "已分享", exact: true }).click();
    await expect(page.getByRole("heading", { name: "分享筆記" })).toBeVisible();

    // Click copy button
    await page.getByTitle("複製連結").click();

    // Verify toast
    await expect(page.getByText("已複製連結")).toBeVisible({ timeout: 5_000 });
  });
});
