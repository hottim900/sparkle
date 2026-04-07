import { test, expect } from "@playwright/test";

/**
 * Layout contract: every route's first DOM-producing element must have
 * flex-1 min-w-0 (or use Fragment so children participate directly in
 * parent flex). This test catches horizontal overflow regressions.
 *
 * We check the route content container (not document.body) because
 * overflow-hidden on the parent hides body-level overflow while content
 * is still clipped. Scanning nested elements with overflowX=visible
 * catches the real problem.
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

        const result = await page.evaluate(() => {
          // Find the route content container (__root.tsx flex-row parent)
          const container = document.querySelector(
            ".relative.flex-1.flex.flex-col.md\\:flex-row.min-w-0.overflow-hidden",
          );
          if (!container)
            return {
              bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
              nested: [],
            };

          // Scan all descendants for visible overflow (not clipped by overflow-hidden/auto)
          const nested: { tag: string; diff: number }[] = [];
          container.querySelectorAll("*").forEach((el) => {
            const diff = el.scrollWidth - el.clientWidth;
            if (diff > 2) {
              const style = getComputedStyle(el);
              if (style.overflowX === "visible") {
                nested.push({ tag: el.tagName, diff });
              }
            }
          });

          return {
            bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
            nested,
          };
        });

        // Body-level overflow (scrollbar visible to user)
        expect(result.bodyOverflow).toBeLessThanOrEqual(2);

        // Nested visible overflow (content clipped by parent overflow-hidden)
        expect(
          result.nested,
          `Found ${result.nested.length} element(s) with visible overflow: ${JSON.stringify(result.nested.slice(0, 3))}`,
        ).toHaveLength(0);
      });
    }
  });
}
