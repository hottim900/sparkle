import { test as setup, expect } from "@playwright/test";
import { AUTH_TOKEN } from "../playwright.config";

setup("authenticate", async ({ page }) => {
  await page.goto("/");

  // Verify login screen is shown
  await expect(page.getByText("請輸入存取權杖以登入")).toBeVisible();

  // Fill in the token and submit
  await page.getByPlaceholder("存取權杖").fill(AUTH_TOKEN);
  await page.getByRole("button", { name: "登入" }).click();

  // Wait for main app to load — desktop starts on dashboard view
  await expect(page.getByText("總覽")).toBeVisible({ timeout: 10_000 });

  // Save auth state
  await page.context().storageState({ path: "e2e/.auth/user.json" });
});
