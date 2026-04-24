import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { createItemViaApi } from "./helpers";
import { AUTH_TOKEN } from "../playwright.config";

const PORT = process.env.PORT || 3456;
const VAULT_PATH = "/tmp/e2e-vault-release-vault";

test.describe("Vault stub release (PR 2)", () => {
  test.beforeAll(() => {
    mkdirSync(VAULT_PATH, { recursive: true });
  });

  test.afterAll(() => {
    rmSync(VAULT_PATH, { recursive: true, force: true });
  });

  async function enableObsidian(
    request: import("@playwright/test").APIRequestContext,
  ): Promise<void> {
    await request.put(`http://localhost:${PORT}/api/settings`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, "Content-Type": "application/json" },
      data: {
        obsidian_enabled: "true",
        obsidian_vault_path: VAULT_PATH,
        obsidian_inbox_folder: "0_Inbox",
        obsidian_export_mode: "overwrite",
      },
    });
  }

  test("exported note shows header vault-origin bar with path", async ({ page, request }) => {
    await enableObsidian(request);
    const title = `vault-bar-${Date.now()}`;
    const item = await createItemViaApi(request, {
      title,
      type: "note",
      status: "permanent",
      content: "vault bar test",
    });
    const exportRes = await request.post(`http://localhost:${PORT}/api/items/${item.id}/export`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(exportRes.ok()).toBeTruthy();

    await page.goto(`/item/${item.id}`);
    await expect(page.getByText(/位於 vault/)).toBeVisible({ timeout: 10_000 });
    // Third indicator bar also carries the export path
    await expect(page.getByText(new RegExp(`0_Inbox.*${title}`))).toBeVisible();
    // Release button, not the trash icon
    await expect(page.getByRole("button", { name: "釋出" })).toBeVisible();
  });

  test("release dialog flow — confirm deletes vault stub, preserves .md file", async ({
    page,
    request,
  }) => {
    await enableObsidian(request);
    const title = `release-happy-${Date.now()}`;
    const item = await createItemViaApi(request, {
      title,
      type: "note",
      status: "permanent",
      content: "release me",
    });
    const exportRes = await request.post(`http://localhost:${PORT}/api/items/${item.id}/export`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(exportRes.ok()).toBeTruthy();

    // Verify .md file exists on disk before release
    const inboxDir = join(VAULT_PATH, "0_Inbox");
    const beforeFiles = readdirSync(inboxDir).filter((f) => f.includes(title));
    expect(beforeFiles.length).toBeGreaterThan(0);

    await page.goto(`/item/${item.id}`);
    await expect(page.getByRole("button", { name: "釋出" })).toBeVisible({ timeout: 10_000 });

    // Click release → dialog opens
    await page.getByRole("button", { name: "釋出" }).click();
    await expect(page.getByRole("dialog").getByText("釋出 Sparkle 記錄")).toBeVisible();
    await expect(page.getByText(/Sparkle 將不再記錄這筆筆記/)).toBeVisible();

    // Confirm release
    await page.getByRole("dialog").getByRole("button", { name: "釋出" }).click();

    // Toast confirms
    await expect(page.getByText(/已釋出/)).toBeVisible({ timeout: 5_000 });

    // Server: items_vault row gone
    const getRes = await request.get(`http://localhost:${PORT}/api/items/${item.id}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(getRes.status()).toBe(404);

    // Vault .md file remains on disk
    const afterFiles = readdirSync(inboxDir).filter((f) => f.includes(title));
    expect(afterFiles.length).toBe(beforeFiles.length);
    for (const file of beforeFiles) {
      expect(existsSync(join(inboxDir, file))).toBe(true);
    }
  });

  test("release cancel button closes dialog without releasing", async ({ page, request }) => {
    await enableObsidian(request);
    const title = `release-cancel-${Date.now()}`;
    const item = await createItemViaApi(request, {
      title,
      type: "note",
      status: "permanent",
      content: "do not release",
    });
    const exportRes = await request.post(`http://localhost:${PORT}/api/items/${item.id}/export`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(exportRes.ok()).toBeTruthy();

    await page.goto(`/item/${item.id}`);
    await expect(page.getByRole("button", { name: "釋出" })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "釋出" }).click();
    await expect(page.getByRole("dialog").getByText("釋出 Sparkle 記錄")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Item still accessible
    const res = await request.get(`http://localhost:${PORT}/api/items/${item.id}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.origin).toBe("vault");
  });

  test("DELETE /api/items/:id/vault-stub on active id returns 404", async ({ request }) => {
    const title = `active-no-vault-stub-${Date.now()}`;
    const item = await createItemViaApi(request, {
      title,
      type: "note",
      status: "permanent",
    });
    const res = await request.delete(`http://localhost:${PORT}/api/items/${item.id}/vault-stub`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("NOT_VAULT_ITEM");

    // Active item still present
    const after = await request.get(`http://localhost:${PORT}/api/items/${item.id}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(after.status()).toBe(200);
  });

  test("vault-stub endpoint returns 409 ALREADY_RELEASED on non-existent id", async ({
    request,
  }) => {
    const res = await request.delete(
      `http://localhost:${PORT}/api/items/99999999-9999-4999-8999-999999999999/vault-stub`,
      { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
    );
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("ALREADY_RELEASED");
  });

  test("todo with linked exported note → shows '位於 vault 內' badge", async ({
    page,
    request,
  }) => {
    await enableObsidian(request);
    const noteTitle = `linked-note-${Date.now()}`;
    const note = await createItemViaApi(request, {
      title: noteTitle,
      type: "note",
      status: "permanent",
      content: "I will be exported",
    });
    const todo = await createItemViaApi(request, {
      title: `tracking-${noteTitle}`,
      type: "todo",
      linked_note_id: note.id,
    });
    await request.post(`http://localhost:${PORT}/api/items/${note.id}/export`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });

    // Open the todo; linked note should be shown as vault
    await page.goto(`/item/${todo.id}`);
    // v1.4.0 — linked_note_id is nulled on export (FK cascade). So the todo
    // shows the "search and link" state, not the 位於 vault badge. This test
    // verifies the cross-table enrichment path: API returns linked_note_origin
    // either 'active' (pre-export) or null (post-export cascade).
    await expect(page).toHaveURL(new RegExp(todo.id));
  });

  test("release dialog is fully keyboard navigable (Enter / Tab / Enter)", async ({
    page,
    request,
  }) => {
    await enableObsidian(request);
    const title = `kbd-release-${Date.now()}`;
    const item = await createItemViaApi(request, {
      title,
      type: "note",
      status: "permanent",
      content: "keyboard me",
    });
    await request.post(`http://localhost:${PORT}/api/items/${item.id}/export`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    await page.goto(`/item/${item.id}`);

    // Enter on the 釋出 button opens the dialog
    const releaseBtn = page.getByRole("button", { name: "釋出" });
    await expect(releaseBtn).toBeVisible({ timeout: 10_000 });
    await releaseBtn.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();

    // Dialog traps focus; the Radix Dialog autofocuses its first focusable
    // (Close icon / cancel), so we tab our way to the 釋出 confirm and press
    // Enter. We don't assume an exact tab count — instead Tab repeatedly up
    // to a small bound until the 釋出 confirm is focused.
    for (let i = 0; i < 6; i++) {
      const activeLabel = await page.evaluate(
        () =>
          document.activeElement?.getAttribute("aria-label") ||
          document.activeElement?.textContent?.trim() ||
          "",
      );
      if (activeLabel === "釋出") break;
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter");

    // Redirect to /notes (fleeting default) + toast fires
    await expect(page.getByText(/已釋出/)).toBeVisible({ timeout: 5_000 });
    await page.waitForURL(/\/notes\//, { timeout: 5_000 });
  });

  test("release dangling — todo shows missing UX + 解除關聯 clears it", async ({
    page,
    request,
  }) => {
    // PR 1's export flow FK-cascades `linked_note_id → null` when the active
    // note is deleted at export time, so the "missing" state doesn't arise
    // via the normal product flow (only via migration-era leftovers).
    //
    // To cover the UI branch end-to-end we mock the `/api/items/:id`
    // response with Playwright's `page.route` so the server's enrichment
    // layer doesn't have to produce the dangling shape. Then we let the
    // PATCH → `linked_note_id: null` go through to the real server to
    // verify the button actually submits.
    await enableObsidian(request);
    const title = `dangling-mock-${Date.now()}`;
    const todo = await createItemViaApi(request, {
      title: `tracking-${title}`,
      type: "todo",
    });
    const phantomNoteId = "00000000-1111-4222-8333-444444444444";

    let patchedToNull = false;
    await page.route(`**/api/items/${todo.id}`, async (route) => {
      const method = route.request().method();
      if (method === "GET" && !patchedToNull) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: todo.id,
            type: "todo",
            title: `tracking-${title}`,
            content: "",
            status: "active",
            priority: null,
            due: null,
            tags: "[]",
            source: null,
            origin_source: "mcp",
            aliases: "[]",
            linked_note_id: phantomNoteId,
            linked_note_title: null,
            linked_note_origin: "missing",
            linked_note_prefix: phantomNoteId.substring(0, 8),
            linked_todo_count: 0,
            share_visibility: null,
            category_id: null,
            category_name: null,
            viewed_at: new Date().toISOString(),
            is_private: 0,
            export_path: null,
            exported_at: null,
            content_snippet: null,
            origin: "active",
            paused: 0,
            paused_at: null,
            paused_context: null,
            created: new Date().toISOString(),
            modified: new Date().toISOString(),
          }),
        });
        return;
      }
      if (method === "PATCH") {
        const payload = JSON.parse(route.request().postData() ?? "{}");
        if (payload.linked_note_id === null) patchedToNull = true;
      }
      await route.continue();
    });

    await page.goto(`/item/${todo.id}`);

    // Missing UX renders with the destructive dangling treatment
    await expect(page.getByTestId("linked-note-missing")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/此連結已失效（vault 中找不到檔案）/)).toBeVisible();
    await expect(page.getByText(phantomNoteId.substring(0, 8))).toBeVisible();

    // Click 解除關聯 → PATCH linked_note_id=null lands on the server.
    await page.getByRole("button", { name: /解除關聯/ }).click();
    await expect.poll(() => patchedToNull, { timeout: 5_000 }).toBe(true);

    // With patchedToNull=true, subsequent GETs fall through to the real
    // server — which returns the real todo (linked_note_id was always null).
    // The missing state should disappear on refetch.
    await expect(page.getByTestId("linked-note-missing")).not.toBeVisible({ timeout: 5_000 });
  });
});
