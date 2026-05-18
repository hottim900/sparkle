import { test, expect } from "@playwright/test";
import { createItemViaApi } from "./helpers";
import { AUTH_TOKEN } from "../playwright.config";

const PORT = process.env.PORT || 3456;
const API_BASE = `http://localhost:${PORT}/api`;

/**
 * End-to-end rename flow: create source + target, rename target via API
 * (the writeable surface), verify the source's content was rewritten and
 * the PATCH response carries swept_references (DX-5 contract).
 *
 * Goes through the same hook chain the user-facing edit form triggers:
 * createItem → reindexItemReferences → updateItem(title) → applyTitleRename
 * → response shape includes swept_references.
 */
test.describe("Wikilink rename engine end-to-end", () => {
  test("renames target, sweeps source content, swept_references in PATCH response", async ({
    request,
  }) => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const oldTitle = `Original-${suffix}`;
    const newTitle = `Renamed-${suffix}`;

    const target = await createItemViaApi(request, {
      title: oldTitle,
      type: "note",
      content: "target body",
    });
    const source = await createItemViaApi(request, {
      title: `Source-${suffix}`,
      type: "note",
      content: `see [[${oldTitle}]] for context`,
    });

    // Force-rebuild the reference index so the rename engine finds the
    // source. Routine writes mark reindex_dirty=1 but the background
    // worker only drains every 60s — too slow for an E2E. Admin rebuild
    // is synchronous-enough for one source.
    await request.post(`${API_BASE}/wikilinks/admin/rebuild`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    // Wait briefly for the worker to drain (it's a setInterval 60s, so we
    // call the internal reindex via PATCH on the source which re-runs the
    // hook). Setting content to same value triggers the hook chain.
    await request.patch(`${API_BASE}/items/${source.id}`, {
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: { content: `see [[${oldTitle}]] for context` },
    });

    // Now rename the target. PATCH response should carry swept_references.
    const renameRes = await request.patch(`${API_BASE}/items/${target.id}`, {
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: { title: newTitle },
    });
    expect(renameRes.ok()).toBe(true);
    const renamePayload = await renameRes.json();
    expect(renamePayload.title).toBe(newTitle);
    expect(renamePayload.swept_references).toBeDefined();
    expect(renamePayload.swept_references.rewritten_count).toBe(1);
    expect(renamePayload.swept_references.rewritten_source_ids).toContain(source.id);
    expect(renamePayload.swept_references.history_id).toBeTruthy();

    // Verify source content was actually rewritten.
    const sourceAfter = await request.get(`${API_BASE}/items/${source.id}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    const sourceBody = await sourceAfter.json();
    expect(sourceBody.content).toBe(`see [[${newTitle}]] for context`);

    // Verify rename_history audit row exists.
    const audit = await request.get(`${API_BASE}/wikilinks/admin/recent-renames?limit=5`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    const auditBody = await audit.json();
    const ourRow = auditBody.renames.find(
      (r: { old_title: string; new_title: string }) =>
        r.old_title === oldTitle && r.new_title === newTitle,
    );
    expect(ourRow).toBeDefined();
    expect(ourRow.source_count).toBe(1);
    expect(ourRow.performed_by).toBe("user");
  });

  test("preview-rename returns count without modifying content", async ({ request }) => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const oldTitle = `Preview-${suffix}`;
    const target = await createItemViaApi(request, {
      title: oldTitle,
      type: "note",
      content: "body",
    });
    const source = await createItemViaApi(request, {
      title: `Src-${suffix}`,
      type: "note",
      content: `link [[${oldTitle}]] here`,
    });

    // Rebuild + reindex source so preview has reference_index data.
    await request.post(`${API_BASE}/wikilinks/admin/rebuild`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    await request.patch(`${API_BASE}/items/${source.id}`, {
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: { content: `link [[${oldTitle}]] here` },
    });

    const previewRes = await request.get(
      `${API_BASE}/wikilinks/admin/preview-rename?target_id=${target.id}&new_title=ProposedNew-${suffix}`,
      { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
    );
    expect(previewRes.ok()).toBe(true);
    const preview = await previewRes.json();
    expect(preview.old_title).toBe(oldTitle);
    expect(preview.would_rewrite_count).toBe(1);
    expect(preview.would_rewrite_source_ids).toContain(source.id);

    // Source content must be untouched after preview.
    const sourceAfter = await request.get(`${API_BASE}/items/${source.id}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    const sourceBody = await sourceAfter.json();
    expect(sourceBody.content).toBe(`link [[${oldTitle}]] here`);
  });

  test("POST /api/items rejects duplicate title with 409 TITLE_COLLISION", async ({ request }) => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const title = `Dup-${suffix}`;
    const first = await request.post(`${API_BASE}/items`, {
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: { title, type: "note", content: "first" },
    });
    expect(first.status()).toBe(201);

    const second = await request.post(`${API_BASE}/items`, {
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: { title, type: "note", content: "second" },
    });
    expect(second.status()).toBe(409);
    const body = await second.json();
    expect(body.code).toBe("TITLE_COLLISION");
    expect(body.attempted_title).toBe(title);
  });
});
