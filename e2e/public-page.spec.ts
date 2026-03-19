import { test, expect } from "@playwright/test";
import { createItemViaApi, createShareViaApi } from "./helpers";

// 6 headings → triggers TOC (MIN_TOC_HEADINGS = 4), enough text for scrollable page
const LONG_CONTENT = Array.from(
  { length: 6 },
  (_, i) =>
    `## Heading ${i + 1}\n\n${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(10)}`,
).join("\n\n");

async function createSharedNote(request: Parameters<typeof createItemViaApi>[0]) {
  const note = await createItemViaApi(request, {
    title: "Public Page E2E Note",
    type: "note",
    content: LONG_CONTENT,
  });
  const { share } = await createShareViaApi(request, note.id, "public");
  return share.token as string;
}

test.describe("Public share page", () => {
  test("inline scripts execute — back-to-top appears after scroll", async ({ page, request }) => {
    const token = await createSharedNote(request);
    await page.goto(`/s/${token}`);

    const backToTop = page.locator(".back-to-top");
    await expect(backToTop).toBeAttached();
    // Initially hidden (opacity: 0, no .visible class)
    await expect(backToTop).not.toHaveClass(/visible/);

    // Scroll past one viewport height
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // If CSP blocks inline script, .visible is never added
    await expect(backToTop).toHaveClass(/visible/, { timeout: 3_000 });
  });

  test("back-to-top scrolls to top on click", async ({ page, request }) => {
    const token = await createSharedNote(request);
    await page.goto(`/s/${token}`);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator(".back-to-top")).toHaveClass(/visible/, { timeout: 3_000 });

    await page.locator(".back-to-top").click();
    await page.waitForFunction(() => window.scrollY < 100);
  });

  test("TOC is rendered with heading links", async ({ page, request }) => {
    const token = await createSharedNote(request);
    await page.goto(`/s/${token}`);

    const toc = page.locator(".toc");
    await expect(toc).toBeAttached();
    // 6 headings in LONG_CONTENT
    await expect(toc.locator("a")).toHaveCount(6);
  });

  test("TOC heading link scrolls to target", async ({ page, request }) => {
    const token = await createSharedNote(request);
    await page.goto(`/s/${token}`);

    // Click a TOC link
    await page.locator('.toc a[href="#heading-3"]').click();

    // Heading 3 should be near the top of viewport
    const headingY = await page
      .locator("#heading-3")
      .evaluate((el) => el.getBoundingClientRect().top);
    expect(headingY).toBeLessThan(200);
  });
});

test.describe("Public share page — mobile", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("TOC toggle opens and closes sidebar", async ({ page, request }) => {
    const token = await createSharedNote(request);
    await page.goto(`/s/${token}`);

    const tocToggle = page.locator(".toc-toggle");
    const toc = page.locator(".toc");

    // Toggle button visible on mobile
    await expect(tocToggle).toBeVisible();

    // TOC initially off-screen
    await expect(toc).not.toHaveClass(/open/);

    // Open
    await tocToggle.click();
    await expect(toc).toHaveClass(/open/);

    // Close via overlay
    await page.locator(".toc-overlay").click();
    await expect(toc).not.toHaveClass(/open/);
  });

  test("TOC link closes sidebar after click", async ({ page, request }) => {
    const token = await createSharedNote(request);
    await page.goto(`/s/${token}`);

    // Open TOC
    await page.locator(".toc-toggle").click();
    await expect(page.locator(".toc")).toHaveClass(/open/);

    // Click a link
    await page.locator(".toc a").first().click();

    // Sidebar should close
    await expect(page.locator(".toc")).not.toHaveClass(/open/);
  });

  test("back-to-top works on mobile", async ({ page, request }) => {
    const token = await createSharedNote(request);
    await page.goto(`/s/${token}`);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator(".back-to-top")).toHaveClass(/visible/, { timeout: 3_000 });
  });
});
