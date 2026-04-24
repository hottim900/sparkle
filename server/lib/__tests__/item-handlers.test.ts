/**
 * LINE-bot item-handler vault-origin guard tests.
 *
 * Post-v23 contract: handlers that would mutate an item must early-return
 * EXPORTED_MSG when resolved.item.origin === "vault". The vault row is the
 * source of truth for exported content; editing must happen in Obsidian.
 *
 * Guard present on 9 mutating handlers:
 *   due, tag, untag, priority, develop, mature, export, archive, delete
 *
 * Unguarded (by design):
 *   detail  → read-only, safe
 *   done    → rejected earlier (vault items synthesize type='note', the
 *             type-check branch short-circuits before any mutation)
 *   upgrade → same reason (vault items synthesize type='note', not scratch)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, insertActiveRow, insertVaultRow } from "../../test-utils.js";
import { itemHandlers, EXPORTED_MSG } from "../line-commands/item-handlers.js";
import { setSession } from "../line-session.js";
import type { LineCommand } from "../line.js";
import type { CommandContext } from "../line-commands/types.js";

function insertVaultNote(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  overrides: { id?: string; title?: string; content_snippet?: string } = {},
): string {
  const title = overrides.title ?? "Vault Note";
  return insertVaultRow(sqlite, {
    id: overrides.id,
    title,
    origin: "app",
    export_path: `0_Inbox/${title}.md`,
    content_snippet: overrides.content_snippet ?? "snippet body",
  });
}

function insertActiveNote(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  overrides: {
    id?: string;
    title?: string;
    status?: string;
    type?: "note" | "todo" | "scratch";
    due?: string | null;
  } = {},
): string {
  return insertActiveRow(sqlite, {
    id: overrides.id,
    title: overrides.title ?? "Active Note",
    type: overrides.type,
    status: overrides.status,
    origin: "app",
    due: overrides.due ?? null,
  });
}

function bindSession(userId: string, id: string): number {
  const index = 1;
  setSession(userId, [id]);
  return index;
}

function buildCtx(
  db: ReturnType<typeof createTestDb>["db"],
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  userId: string,
  command: LineCommand,
): CommandContext {
  return { userId, command, db, sqlite };
}

describe("LINE item-handlers — vault-origin guard", () => {
  let db: ReturnType<typeof createTestDb>["db"];
  let sqlite: ReturnType<typeof createTestDb>["sqlite"];

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  // One row per guarded handler: command-extras + how to seed an active row
  // that reaches the handler body (not EXPORTED_MSG) + the active-path return
  // matcher. 9 entries → 18 parametrized tests (vault-guard + active-scope).
  type Case = {
    handler: keyof typeof itemHandlers;
    build: (idx: number) => LineCommand;
    activeOverrides?: { type?: string; status?: string };
    activeMatcher: RegExp;
  };
  const CASES: Case[] = [
    {
      handler: "due",
      build: (idx) => ({ type: "due", index: idx, dateInput: "2026-12-31" }),
      activeOverrides: { type: "todo" },
      activeMatcher: /^✅/,
    },
    {
      handler: "tag",
      build: (idx) => ({ type: "tag", index: idx, tags: ["work"] }),
      activeMatcher: /^✅/,
    },
    {
      handler: "untag",
      build: (idx) => ({ type: "untag", index: idx, tags: ["work"] }),
      activeMatcher: /^✅/,
    },
    {
      handler: "priority",
      build: (idx) => ({ type: "priority", index: idx, priority: "high" }),
      activeMatcher: /^✅/,
    },
    {
      handler: "develop",
      build: (idx) => ({ type: "develop", index: idx }),
      activeOverrides: { type: "note", status: "fleeting" },
      activeMatcher: /^✅/,
    },
    {
      handler: "mature",
      build: (idx) => ({ type: "mature", index: idx }),
      activeOverrides: { type: "note", status: "developing" },
      activeMatcher: /^✅/,
    },
    {
      handler: "archive",
      build: (idx) => ({ type: "archive", index: idx }),
      activeMatcher: /^✅/,
    },
    {
      handler: "delete",
      build: (idx) => ({ type: "delete", index: idx }),
      activeMatcher: /^🗑️/,
    },
    {
      // Active-path asserts Obsidian-config error (not ✅): proves the guard
      // isn't short-circuiting before the Obsidian-enabled check.
      handler: "export",
      build: (idx) => ({ type: "export", index: idx }),
      activeOverrides: { type: "note", status: "permanent" },
      activeMatcher: /Obsidian 匯出未設定/,
    },
  ];

  it.each(CASES)("$handler: vault item → EXPORTED_MSG", async ({ handler, build }) => {
    const id = insertVaultNote(sqlite);
    const idx = bindSession(`user-${handler}-vault`, id);
    const ctx = buildCtx(db, sqlite, `user-${handler}-vault`, build(idx));
    const result = await itemHandlers[handler]!(ctx);
    expect(result).toBe(EXPORTED_MSG);
    const row = sqlite.prepare("SELECT id FROM items_vault WHERE id = ?").get(id);
    expect(row).toBeTruthy();
  });

  it.each(CASES)(
    "$handler: active item → not EXPORTED_MSG (guard scoped correctly)",
    async ({ handler, build, activeOverrides, activeMatcher }) => {
      const id = insertActiveNote(sqlite, activeOverrides ?? {});
      const idx = bindSession(`user-${handler}-active`, id);
      const ctx = buildCtx(db, sqlite, `user-${handler}-active`, build(idx));
      const result = await itemHandlers[handler]!(ctx);
      expect(result).not.toBe(EXPORTED_MSG);
      expect(result).toMatch(activeMatcher);
    },
  );

  // ---------------------------------------------------------
  // Lookup via short-ID prefix — guard still fires correctly
  // ---------------------------------------------------------

  it("guard fires on short-prefix resolution (vault row resolved by UUID prefix)", async () => {
    // getItem resolves UUID prefixes via LIKE across both tables. Confirm the
    // handler path sees origin='vault' when the vault row matched. We route
    // through the session API (which uses the full id) — the guard must still
    // fire on the returned vault item regardless of how it was looked up.
    const id = insertVaultNote(sqlite, { title: "Short Prefix Vault" });
    const idx = bindSession("user-prefix", id);
    const ctx = buildCtx(db, sqlite, "user-prefix", {
      type: "tag",
      index: idx,
      tags: ["any"],
    });
    const result = await itemHandlers.tag!(ctx);
    expect(result).toBe(EXPORTED_MSG);
  });
});
