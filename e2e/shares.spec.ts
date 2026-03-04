import { test, expect } from "@playwright/test";
import { createItemViaApi, createShareViaApi, navigateTo } from "./helpers";

test.describe("Share Management", () => {
  test("navigates to share management page and displays shares", async ({ page, request }) => {
    // Create a note and share it
    const note = await createItemViaApi(request, {
      title: "E2E Shared Note",
      type: "note",
    });
    await createShareViaApi(request, note.id, "public");

    await page.goto("/");

    // Navigate to share management via sidebar
    await navigateTo(page, "分享管理");

    // Verify page loaded (lazy-loaded)
    await expect(page.getByRole("heading", { name: "分享管理" })).toBeVisible({
      timeout: 10_000,
    });

    // Verify share is listed with correct details
    const shareRow = page.locator(".rounded-md.border", { hasText: "E2E Shared Note" });
    await expect(shareRow).toBeVisible();
    await expect(shareRow.getByText("公開")).toBeVisible();
  });

  test("revokes share with confirmation dialog", async ({ page, request }) => {
    const note = await createItemViaApi(request, {
      title: "Note To Revoke",
      type: "note",
    });
    await createShareViaApi(request, note.id);

    await page.goto("/");
    await navigateTo(page, "分享管理");

    await expect(page.getByText("Note To Revoke")).toBeVisible({ timeout: 10_000 });

    // Find the row containing "Note To Revoke" and click its revoke button
    const row = page.locator(".rounded-md.border", { hasText: "Note To Revoke" });
    await row.getByTitle("撤銷分享").click();

    // Confirmation dialog should appear
    await expect(page.getByText("確認撤銷分享")).toBeVisible();
    await expect(page.getByText(/確定要撤銷「Note To Revoke」/)).toBeVisible();

    // Confirm revoke
    await page.getByRole("button", { name: "撤銷" }).click();

    // Share should be removed
    await expect(page.getByText("Note To Revoke")).not.toBeVisible({ timeout: 5_000 });
  });

  test("navigates to source note when title is clicked", async ({ page, request }) => {
    const note = await createItemViaApi(request, {
      title: "Navigate Target Note",
      type: "note",
      content: "This is the target note content.",
    });
    await createShareViaApi(request, note.id);

    await page.goto("/");
    await navigateTo(page, "分享管理");

    await expect(page.getByText("Navigate Target Note")).toBeVisible({ timeout: 10_000 });

    // Click the note title to navigate
    await page.getByText("Navigate Target Note").click();

    // Should navigate to the note detail view
    await expect(page.getByText("This is the target note content.")).toBeVisible({
      timeout: 10_000,
    });
  });
});
