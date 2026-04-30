import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, renameSync } from "node:fs";
import { join } from "node:path";

import { createItemViaApi } from "./helpers";
import { AUTH_TOKEN } from "../playwright.config";

const PORT = process.env.PORT || 3456;
const VAULT_PATH = "/tmp/e2e-vault-rename-vault";

/**
 * PR 2 reverse-lookup contract:
 *   GET /api/vault/by-sparkle-id/:id resolves the *current* path of an
 *   exported .md, sourced from vault_files (not items_vault.export_path).
 *
 * Full rename roundtrip (rename .md on disk → 5-min scanner picks it up →
 * UI reflects new path) requires either a 5-minute wait or a test-only scan
 * trigger; this spec instead asserts the API contract that the UI relies on.
 */
test.describe("Vault reverse-lookup endpoint (PR 2)", () => {
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

  test("export seeds vault_files so reverse-lookup hits immediately (no 5-min wait)", async ({
    request,
  }) => {
    await enableObsidian(request);
    const title = `rev-lookup-${Date.now()}`;
    const item = await createItemViaApi(request, {
      title,
      type: "note",
      status: "permanent",
      content: "reverse-lookup test",
    });

    const exportRes = await request.post(`http://localhost:${PORT}/api/items/${item.id}/export`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(exportRes.ok()).toBeTruthy();
    const exported = (await exportRes.json()) as { path: string };

    // Reverse-lookup is reachable IMMEDIATELY because commitExportToVault now
    // seeds vault_files inside the same transaction (PR 2 export atomicity).
    const lookupRes = await request.get(
      `http://localhost:${PORT}/api/vault/by-sparkle-id/${item.id}`,
      { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
    );
    expect(lookupRes.ok()).toBeTruthy();
    const looked = (await lookupRes.json()) as { path: string };
    expect(looked.path).toBe(exported.path);

    // Cache header lets the UI dedupe per-render fetches without spamming.
    expect(lookupRes.headers()["cache-control"]).toContain("max-age=60");
  });

  test("reverse-lookup returns 404 when sparkle_id is unknown", async ({ request }) => {
    const fakeId = "00000000-0000-4000-8000-000000000000";
    const res = await request.get(`http://localhost:${PORT}/api/vault/by-sparkle-id/${fakeId}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(res.status()).toBe(404);
  });

  test("reverse-lookup rejects malformed UUIDs", async ({ request }) => {
    const res = await request.get(`http://localhost:${PORT}/api/vault/by-sparkle-id/not-a-uuid`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(res.status()).toBe(400);
  });

  test("rename on disk does NOT desync reverse-lookup until next scan (documented limitation)", async ({
    request,
  }) => {
    await enableObsidian(request);
    const title = `rename-stale-${Date.now()}`;
    const item = await createItemViaApi(request, {
      title,
      type: "note",
      status: "permanent",
      content: "stale path test",
    });

    const exportRes = await request.post(`http://localhost:${PORT}/api/items/${item.id}/export`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(exportRes.ok()).toBeTruthy();
    const exported = (await exportRes.json()) as { path: string };

    // Move the .md without telling the server. vault_files row still has the
    // old path; reverse-lookup serves the stale value until scanner re-indexes.
    const oldFull = join(VAULT_PATH, exported.path);
    mkdirSync(join(VAULT_PATH, "Renamed"), { recursive: true });
    const newRelative = `Renamed/${exported.path.split("/").pop()}`;
    renameSync(oldFull, join(VAULT_PATH, newRelative));

    const lookupRes = await request.get(
      `http://localhost:${PORT}/api/vault/by-sparkle-id/${item.id}`,
      { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
    );
    expect(lookupRes.ok()).toBeTruthy();
    const looked = (await lookupRes.json()) as { path: string };
    // Until next scan: still the old path. UI's `keepPreviousData` keeps the
    // currently-displayed link valid; on next refetch (60s staleTime) the new
    // path lands. This is the contract documented in `useVaultPathBySparkleId`.
    expect(looked.path).toBe(exported.path);
  });
});
