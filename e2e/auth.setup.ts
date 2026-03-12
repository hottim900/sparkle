import { test as setup, expect } from "@playwright/test";
import { AUTH_TOKEN } from "../playwright.config";

setup("authenticate", async ({ page }) => {
  await page.goto("/");

  // Verify login screen is shown
  await expect(page.getByText("請輸入存取權杖以登入")).toBeVisible();

  // Fill in the token and submit
  await page.getByPlaceholder("存取權杖").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "登入" }).click();

  // Wait for main app to load — now redirects to /notes/fleeting
  await expect(page.getByPlaceholder("快速記錄...")).toBeVisible({ timeout: 10_000 });

  // Save auth state
  await page.context().storageState({ path: "e2e/.auth/user.json" });
});
