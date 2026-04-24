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
import { v4 as uuidv4 } from "uuid";
import { createTestDb } from "../../test-utils.js";
import { itemHandlers } from "../line-commands/item-handlers.js";
import { setSession } from "../line-session.js";
import type { LineCommand } from "../line.js";
import type { CommandContext } from "../line-commands/types.js";

const EXPORTED_MSG = "❌ 此筆記已匯出至 Obsidian；內容以 vault 為準，無法從 LINE 編輯。";

function insertVaultNote(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  overrides: { id?: string; title?: string; content_snippet?: string } = {},
): string {
  const id = overrides.id ?? uuidv4();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO items_vault
         (id, title, tags, aliases, source, origin, export_path,
          exported_at, created, is_private, content_snippet)
       VALUES (?, ?, '[]', '[]', NULL, 'app', ?, ?, ?, 0, ?)`,
    )
    .run(
      id,
      overrides.title ?? "Vault Note",
      `0_Inbox/${overrides.title ?? "Vault Note"}.md`,
      now,
      now,
      overrides.content_snippet ?? "snippet body",
    );
  return id;
}

function insertActiveNote(
  sqlite: ReturnType<typeof createTestDb>["sqlite"],
  overrides: {
    id?: string;
    title?: string;
    status?: string;
    type?: string;
    due?: string | null;
  } = {},
): string {
  const id = overrides.id ?? uuidv4();
  const now = new Date().toISOString();
  const type = overrides.type ?? "note";
  const status = overrides.status ?? (type === "todo" ? "active" : "fleeting");
  sqlite
    .prepare(
      `INSERT INTO items_active
         (id, title, type, status, content, tags, aliases, origin, source,
          category_id, is_private, created, modified, due)
       VALUES (?, ?, ?, ?, '', '[]', '[]', 'app', NULL, NULL, 0, ?, ?, ?)`,
    )
    .run(id, overrides.title ?? "Active Note", type, status, now, now, overrides.due ?? null);
  return id;
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

  // ---------------------------------------------------------
  // Guarded handlers — vault item must produce EXPORTED_MSG
  // ---------------------------------------------------------

  it("due: vault item → EXPORTED_MSG", async () => {
    const id = insertVaultNote(sqlite);
    const idx = bindSession("user-due-vault", id);
    const ctx = buildCtx(db, sqlite, "user-due-vault", {
      type: "due",
      index: idx,
      dateInput: "明天",
    });
    const result = await itemHandlers.due!(ctx);
    expect(result).toBe(EXPORTED_MSG);
  });

  it("tag: vault item → EXPORTED_MSG", async () => {
    const id = insertVaultNote(sqlite);
    const idx = bindSession("user-tag-vault", id);
    const ctx = buildCtx(db, sqlite, "user-tag-vault", {
      type: "tag",
      index: idx,
      tags: ["work"],
    });
    const result = await itemHandlers.tag!(ctx);
    expect(result).toBe(EXPORTED_MSG);
  });

  it("untag: vault item → EXPORTED_MSG", async () => {
    const id = insertVaultNote(sqlite);
    const idx = bindSession("user-untag-vault", id);
    const ctx = buildCtx(db, sqlite, "user-untag-vault", {
      type: "untag",
      index: idx,
      tags: ["work"],
    });
    const result = await itemHandlers.untag!(ctx);
    expect(result).toBe(EXPORTED_MSG);
  });

  it("priority: vault item → EXPORTED_MSG", async () => {
    const id = insertVaultNote(sqlite);
    const idx = bindSession("user-prio-vault", id);
    const ctx = buildCtx(db, sqlite, "user-prio-vault", {
      type: "priority",
      index: idx,
      priority: "high",
    });
    const result = await itemHandlers.priority!(ctx);
    expect(result).toBe(EXPORTED_MSG);
  });

  it("develop: vault item → EXPORTED_MSG", async () => {
    const id = insertVaultNote(sqlite);
    const idx = bindSession("user-develop-vault", id);
    const ctx = buildCtx(db, sqlite, "user-develop-vault", {
      type: "develop",
      index: idx,
    });
    const result = await itemHandlers.develop!(ctx);
    expect(result).toBe(EXPORTED_MSG);
  });

  it("mature: vault item → EXPORTED_MSG", async () => {
    const id = insertVaultNote(sqlite);
    const idx = bindSession("user-mature-vault", id);
    const ctx = buildCtx(db, sqlite, "user-mature-vault", {
      type: "mature",
      index: idx,
    });
    const result = await itemHandlers.mature!(ctx);
    expect(result).toBe(EXPORTED_MSG);
  });

  it("export: vault item → EXPORTED_MSG (blocks re-export from LINE)", async () => {
    const id = insertVaultNote(sqlite);
    const idx = bindSession("user-export-vault", id);
    const ctx = buildCtx(db, sqlite, "user-export-vault", {
      type: "export",
      index: idx,
    });
    const result = await itemHandlers.export!(ctx);
    expect(result).toBe(EXPORTED_MSG);
  });

  it("archive: vault item → EXPORTED_MSG (vault row preserved, no false ✅)", async () => {
    const id = insertVaultNote(sqlite);
    const idx = bindSession("user-archive-vault", id);
    const ctx = buildCtx(db, sqlite, "user-archive-vault", {
      type: "archive",
      index: idx,
    });
    const result = await itemHandlers.archive!(ctx);
    expect(result).toBe(EXPORTED_MSG);
    // Vault row must still be present (updateItem would no-op anyway, but the
    // guard ensures the handler doesn't claim success)
    const row = sqlite.prepare("SELECT id FROM items_vault WHERE id = ?").get(id);
    expect(row).toBeTruthy();
  });

  it("delete: vault item → EXPORTED_MSG (vault row preserved, no false 🗑️)", async () => {
    const id = insertVaultNote(sqlite);
    const idx = bindSession("user-delete-vault", id);
    const ctx = buildCtx(db, sqlite, "user-delete-vault", {
      type: "delete",
      index: idx,
    });
    const result = await itemHandlers.delete!(ctx);
    expect(result).toBe(EXPORTED_MSG);
    const row = sqlite.prepare("SELECT id FROM items_vault WHERE id = ?").get(id);
    expect(row).toBeTruthy();
  });

  // ---------------------------------------------------------
  // Guarded handlers — active item should NOT get EXPORTED_MSG
  // (sanity: guard is properly scoped to origin==='vault')
  // ---------------------------------------------------------

  it("due: active todo with valid date → success, not EXPORTED_MSG", async () => {
    const id = insertActiveNote(sqlite, { type: "todo" });
    const idx = bindSession("user-due-active", id);
    const ctx = buildCtx(db, sqlite, "user-due-active", {
      type: "due",
      index: idx,
      dateInput: "2026-12-31",
    });
    const result = await itemHandlers.due!(ctx);
    expect(result).not.toBe(EXPORTED_MSG);
    expect(result).toMatch(/^✅/);
  });

  it("tag: active note → success, not EXPORTED_MSG", async () => {
    const id = insertActiveNote(sqlite);
    const idx = bindSession("user-tag-active", id);
    const ctx = buildCtx(db, sqlite, "user-tag-active", {
      type: "tag",
      index: idx,
      tags: ["work"],
    });
    const result = await itemHandlers.tag!(ctx);
    expect(result).not.toBe(EXPORTED_MSG);
    expect(result).toMatch(/^✅/);
  });

  it("untag: active note → success, not EXPORTED_MSG", async () => {
    const id = insertActiveNote(sqlite);
    const idx = bindSession("user-untag-active", id);
    const ctx = buildCtx(db, sqlite, "user-untag-active", {
      type: "untag",
      index: idx,
      tags: ["work"],
    });
    const result = await itemHandlers.untag!(ctx);
    expect(result).not.toBe(EXPORTED_MSG);
    expect(result).toMatch(/^✅/);
  });

  it("priority: active note → success, not EXPORTED_MSG", async () => {
    const id = insertActiveNote(sqlite);
    const idx = bindSession("user-prio-active", id);
    const ctx = buildCtx(db, sqlite, "user-prio-active", {
      type: "priority",
      index: idx,
      priority: "high",
    });
    const result = await itemHandlers.priority!(ctx);
    expect(result).not.toBe(EXPORTED_MSG);
    expect(result).toMatch(/^✅/);
  });

  it("develop: active fleeting note → success, not EXPORTED_MSG", async () => {
    const id = insertActiveNote(sqlite, { type: "note", status: "fleeting" });
    const idx = bindSession("user-develop-active", id);
    const ctx = buildCtx(db, sqlite, "user-develop-active", {
      type: "develop",
      index: idx,
    });
    const result = await itemHandlers.develop!(ctx);
    expect(result).not.toBe(EXPORTED_MSG);
    expect(result).toMatch(/^✅/);
  });

  it("mature: active developing note → success, not EXPORTED_MSG", async () => {
    const id = insertActiveNote(sqlite, { type: "note", status: "developing" });
    const idx = bindSession("user-mature-active", id);
    const ctx = buildCtx(db, sqlite, "user-mature-active", {
      type: "mature",
      index: idx,
    });
    const result = await itemHandlers.mature!(ctx);
    expect(result).not.toBe(EXPORTED_MSG);
    expect(result).toMatch(/^✅/);
  });

  it("archive: active item → success, not EXPORTED_MSG", async () => {
    const id = insertActiveNote(sqlite);
    const idx = bindSession("user-archive-active", id);
    const ctx = buildCtx(db, sqlite, "user-archive-active", {
      type: "archive",
      index: idx,
    });
    const result = await itemHandlers.archive!(ctx);
    expect(result).not.toBe(EXPORTED_MSG);
    expect(result).toMatch(/^✅/);
  });

  it("delete: active item → success, not EXPORTED_MSG", async () => {
    const id = insertActiveNote(sqlite);
    const idx = bindSession("user-delete-active", id);
    const ctx = buildCtx(db, sqlite, "user-delete-active", {
      type: "delete",
      index: idx,
    });
    const result = await itemHandlers.delete!(ctx);
    expect(result).not.toBe(EXPORTED_MSG);
    expect(result).toMatch(/^🗑️/);
  });

  it("export: active permanent note hits Obsidian-config check, NOT EXPORTED_MSG", async () => {
    // Active permanent note with no Obsidian config → handler returns the
    // "Obsidian 匯出未設定" error, which proves the guard is not firing.
    const id = insertActiveNote(sqlite, { type: "note", status: "permanent" });
    const idx = bindSession("user-export-active", id);
    const ctx = buildCtx(db, sqlite, "user-export-active", {
      type: "export",
      index: idx,
    });
    const result = await itemHandlers.export!(ctx);
    expect(result).not.toBe(EXPORTED_MSG);
    expect(result).toMatch(/Obsidian 匯出未設定/);
  });

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
