import { test, expect } from "@playwright/test";

/**
 * Layout contract: every route's first DOM-producing element must have
 * flex-1 min-w-0 (or use Fragment so children participate directly in
 * parent flex). This test catches horizontal overflow regressions.
 */

const routes = [
  { path: "/dashboard", name: "Dashboard" },
  { path: "/vault", name: "Vault" },
  { path: "/settings", name: "Settings" },
  { path: "/shares", name: "Shares" },
  { path: "/notes/fleeting", name: "Notes" },
  { path: "/todos", name: "Todos" },
];

const viewports = [
  { width: 1280, height: 720, label: "desktop" },
  { width: 768, height: 1024, label: "tablet" },
];

for (const vp of viewports) {
  test.describe(`Layout overflow — ${vp.label} (${vp.width}px)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const route of routes) {
      test(`${route.name} has no horizontal overflow`, async ({ page }) => {
        await page.goto(route.path);
        // Wait for route to render (heading, button, or main content)
        await page.waitForLoadState("networkidle");

        const overflow = await page.evaluate(() => {
          return document.body.scrollWidth - document.body.clientWidth;
        });

        // Allow 2px tolerance for subpixel rendering
        expect(overflow).toBeLessThanOrEqual(2);
      });
    }
  });
}
