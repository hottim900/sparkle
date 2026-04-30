import { sql, inArray, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { itemsActive, itemsVault, shareTokens, categories, vaultFiles } from "../db/schema.js";
import type * as schema from "../db/schema.js";

type DB = BetterSQLite3Database<typeof schema>;

type ActiveRow = typeof itemsActive.$inferSelect;
type VaultRow = typeof itemsVault.$inferSelect;

/**
 * Unified item shape returned by getItem/listItems/searchItems.
 *
 * - `origin: 'active'` rows carry status/content/paused/viewed_at/etc. — vault-only fields (content_snippet, export_path, exported_at, vault_path) are null.
 * - `origin: 'vault'` rows carry content_snippet/export_path/exported_at + vault_path (live reverse-lookup result, source-of-truth path) — active-only fields (status, content, paused, viewed_at, priority, due, linked_note_id) are null.
 *
 * `vault_path` (PR 2 dual-write window): live path resolved via vault_files.sparkle_id reverse-lookup.
 *   When present, callers should prefer it over `export_path`. PR 3 drops `export_path` entirely.
 * `export_path` is the items_vault.export_path snapshot — kept as fallback while reverse-lookup catches up.
 *
 * `linked_note_origin` is set only on todos whose `linked_note_id` points somewhere;
 *   - 'active'  → linked note still in items_active
 *   - 'vault'   → linked note has been exported (now in items_vault)
 *   - 'missing' → linked note was released (the vault row was hard-deleted); UI shows dangling state
 * `linked_note_prefix` is the first 8 chars of linked_note_id (for display when origin='missing').
 */
export type ItemWithLinkedInfo = {
  id: string;
  type: "note" | "todo" | "scratch";
  title: string;
  category_id: string | null;
  tags: string;
  aliases: string;
  source: string | null;
  origin_source: string | null; // legacy "origin" column (capture source: LINE/PWA/MCP). Renamed to avoid clash with the active/vault marker.
  created: string;
  modified: string;
  is_private: number;

  // For vault-origin rows, status is synthesized as "exported" and content=content_snippet.
  status:
    | "fleeting"
    | "developing"
    | "permanent"
    | "exported"
    | "active"
    | "done"
    | "draft"
    | "archived";
  content: string;
  priority: "low" | "medium" | "high" | null;
  due: string | null;
  linked_note_id: string | null;
  viewed_at: string | null;
  paused: number;
  paused_at: string | null;
  paused_context: string | null;

  // Vault-only fields (null when origin === 'active')
  content_snippet: string | null;
  export_path: string | null; // @deprecated PR 3 drops this — prefer vault_path
  /** Live vault path from vault_files reverse-lookup (null = no match yet). */
  vault_path: string | null;
  exported_at: string | null;

  // Origin marker — caller branches on this
  origin: "active" | "vault";

  // Enriched cross-table fields
  linked_note_title: string | null;
  linked_note_origin: "active" | "vault" | "missing" | null;
  linked_note_prefix: string | null;
  linked_todo_count: number;
  share_visibility: "public" | "unlisted" | null;
  category_name: string | null;
};

function activeBase(
  row: ActiveRow,
): Omit<
  ItemWithLinkedInfo,
  | "linked_note_title"
  | "linked_note_origin"
  | "linked_note_prefix"
  | "linked_todo_count"
  | "share_visibility"
  | "category_name"
> {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    category_id: row.category_id,
    tags: row.tags,
    aliases: row.aliases,
    source: row.source,
    origin_source: row.origin ?? null,
    created: row.created,
    modified: row.modified,
    is_private: row.is_private ?? 0,
    status: row.status,
    content: row.content ?? "",
    priority: row.priority,
    due: row.due,
    linked_note_id: row.linked_note_id,
    viewed_at: row.viewed_at,
    paused: row.paused,
    paused_at: row.paused_at,
    paused_context: row.paused_context,
    content_snippet: null,
    export_path: null,
    vault_path: null,
    exported_at: null,
    origin: "active" as const,
  };
}

function vaultBase(
  row: VaultRow,
  vault_path: string | null = null,
): Omit<
  ItemWithLinkedInfo,
  | "linked_note_title"
  | "linked_note_origin"
  | "linked_note_prefix"
  | "linked_todo_count"
  | "share_visibility"
  | "category_name"
> {
  return {
    id: row.id,
    type: "note",
    title: row.title,
    category_id: row.category_id,
    tags: row.tags,
    aliases: row.aliases,
    source: row.source,
    origin_source: row.origin ?? null,
    created: row.created,
    // Surface-level UI compat: synthesize status='exported', content=snippet, modified=exported_at
    modified: row.exported_at,
    is_private: row.is_private,
    status: "exported" as const,
    content: row.content_snippet,
    priority: null,
    due: null,
    linked_note_id: null,
    viewed_at: null,
    paused: 0,
    paused_at: null,
    paused_context: null,
    content_snippet: row.content_snippet,
    export_path: row.export_path,
    vault_path,
    exported_at: row.exported_at,
    origin: "vault" as const,
  };
}

/**
 * Enrich a mixed list of active + vault rows with cross-table linked info.
 * Pass all rows in one call to batch the JOINs.
 *
 * Vault rows accept an optional `vault_path` (already-resolved by the caller's
 * LEFT JOIN, e.g. listVaultItems). Rows without it fall through to a single
 * batched IN-clause reverse-lookup so single-row callers (getItem) and
 * cross-table merges (listItemsAcross) still surface a live path.
 */
export function resolveLinkedInfo(
  db: DB,
  rows: Array<
    | { kind: "active"; row: ActiveRow }
    | { kind: "vault"; row: VaultRow; vault_path?: string | null }
  >,
  enrich = true,
  includePrivate = false,
): ItemWithLinkedInfo[] {
  if (rows.length === 0) return [];

  // Reverse-lookup vault_path for any vault row that didn't arrive pre-hydrated.
  // Single batched query against idx_vault_files_sparkle_id partial index.
  const missingVaultIds = rows
    .filter((r) => r.kind === "vault" && r.vault_path === undefined)
    .map((r) => r.row.id);
  const reverseLookup = new Map<string, string>();
  if (missingVaultIds.length > 0) {
    const unique = [...new Set(missingVaultIds)];
    const vfRows = db
      .select({ sparkle_id: vaultFiles.sparkle_id, path: vaultFiles.path })
      .from(vaultFiles)
      .where(inArray(vaultFiles.sparkle_id, unique))
      .all();
    for (const vf of vfRows) {
      if (vf.sparkle_id) reverseLookup.set(vf.sparkle_id, vf.path);
    }
  }

  const bases = rows.map((r) => {
    if (r.kind === "active") return activeBase(r.row);
    const vault_path =
      r.vault_path !== undefined ? r.vault_path : (reverseLookup.get(r.row.id) ?? null);
    return vaultBase(r.row, vault_path);
  });

  if (!enrich) {
    return bases.map((b) => ({
      ...b,
      linked_note_title: null,
      linked_note_origin: null,
      linked_note_prefix: null,
      linked_todo_count: 0,
      share_visibility: null,
      category_name: null,
    }));
  }

  // Resolve linked_note cross-table: todos carry linked_note_id; the pointed-at
  // id may be in items_active (not yet exported) or items_vault (exported) or
  // missing (released). Run two JOINs + synthesize 'missing' branch.
  const linkedIds = bases.map((r) => r.linked_note_id).filter((id): id is string => id != null);

  const linkedActive = new Map<string, string>();
  const linkedVault = new Map<string, string>();
  if (linkedIds.length > 0) {
    const unique = [...new Set(linkedIds)];
    const activeRows = db
      .select({ id: itemsActive.id, title: itemsActive.title })
      .from(itemsActive)
      .where(
        and(
          inArray(itemsActive.id, unique),
          includePrivate ? undefined : sql`${itemsActive.is_private} = 0`,
        ),
      )
      .all();
    for (const li of activeRows) linkedActive.set(li.id, li.title);

    const vaultRows = db
      .select({ id: itemsVault.id, title: itemsVault.title })
      .from(itemsVault)
      .where(
        and(
          inArray(itemsVault.id, unique),
          includePrivate ? undefined : sql`${itemsVault.is_private} = 0`,
        ),
      )
      .all();
    for (const li of vaultRows) linkedVault.set(li.id, li.title);
  }

  // linked_todo_count — count active todos pointing at each note id. Only note
  // rows can be linked-to (todos/scratch aren't valid link targets), so limit
  // the IN-list to note-typed bases; vault rows are always notes.
  const noteIds = bases.filter((r) => r.type === "note").map((r) => r.id);
  const countMap = new Map<string, number>();
  if (noteIds.length > 0) {
    const unique = [...new Set(noteIds)];
    const counts = db
      .select({
        linked_note_id: itemsActive.linked_note_id,
        count: sql<number>`count(*)`,
      })
      .from(itemsActive)
      .where(
        and(
          inArray(itemsActive.linked_note_id, unique),
          sql`${itemsActive.status} != 'archived'`,
          includePrivate ? undefined : sql`${itemsActive.is_private} = 0`,
        ),
      )
      .groupBy(itemsActive.linked_note_id)
      .all();
    for (const c of counts) {
      if (c.linked_note_id) countMap.set(c.linked_note_id, c.count);
    }
  }

  // Share visibility — share_tokens FK only points to items_active post-migration 23.
  // Vault IDs will never match; filter them out rather than padding the IN-list.
  const allIds = bases.filter((r) => r.origin === "active").map((r) => r.id);
  const shareMap = new Map<string, "public" | "unlisted">();
  if (allIds.length > 0) {
    const unique = [...new Set(allIds)];
    const shareRows = db
      .select({
        item_id: shareTokens.item_id,
        has_public: sql<number>`MAX(CASE WHEN ${shareTokens.visibility} = 'public' THEN 1 ELSE 0 END)`,
      })
      .from(shareTokens)
      .where(inArray(shareTokens.item_id, unique))
      .groupBy(shareTokens.item_id)
      .all();
    for (const sr of shareRows) {
      shareMap.set(sr.item_id, sr.has_public ? "public" : "unlisted");
    }
  }

  // Category name resolution
  const categoryIds = bases.map((r) => r.category_id).filter((id): id is string => id != null);
  const catNameMap = new Map<string, string>();
  if (categoryIds.length > 0) {
    const unique = [...new Set(categoryIds)];
    const catRows = db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(inArray(categories.id, unique))
      .all();
    for (const cr of catRows) catNameMap.set(cr.id, cr.name);
  }

  return bases.map((b) => {
    let linked_note_title: string | null = null;
    let linked_note_origin: "active" | "vault" | "missing" | null = null;
    let linked_note_prefix: string | null = null;

    if (b.linked_note_id) {
      const activeTitle = linkedActive.get(b.linked_note_id);
      const vaultTitle = linkedVault.get(b.linked_note_id);
      if (activeTitle !== undefined) {
        linked_note_title = activeTitle;
        linked_note_origin = "active";
      } else if (vaultTitle !== undefined) {
        linked_note_title = vaultTitle;
        linked_note_origin = "vault";
      } else {
        linked_note_origin = "missing";
        linked_note_prefix = b.linked_note_id.substring(0, 8);
      }
    }

    return {
      ...b,
      linked_note_title,
      linked_note_origin,
      linked_note_prefix,
      linked_todo_count: b.type === "note" ? (countMap.get(b.id) ?? 0) : 0,
      share_visibility: shareMap.get(b.id) ?? null,
      category_name: b.category_id ? (catNameMap.get(b.category_id) ?? null) : null,
    };
  });
}

/** Convenience wrapper for callers that only have active rows. */
export function resolveLinkedInfoActive(
  db: DB,
  rows: ActiveRow[],
  enrich = true,
  includePrivate = false,
): ItemWithLinkedInfo[] {
  return resolveLinkedInfo(
    db,
    rows.map((row) => ({ kind: "active" as const, row })),
    enrich,
    includePrivate,
  );
}

/** Convenience wrapper for callers that only have vault rows. */
export function resolveLinkedInfoVault(
  db: DB,
  rows: Array<VaultRow | { row: VaultRow; vault_path: string | null }>,
  enrich = true,
  includePrivate = false,
): ItemWithLinkedInfo[] {
  return resolveLinkedInfo(
    db,
    rows.map((entry) =>
      "row" in entry
        ? { kind: "vault" as const, row: entry.row, vault_path: entry.vault_path }
        : { kind: "vault" as const, row: entry },
    ),
    enrich,
    includePrivate,
  );
}
