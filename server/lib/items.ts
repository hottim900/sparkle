import { eq, desc, asc, sql, and, notInArray, like } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { itemsActive, itemsVault } from "../db/schema.js";
import type { CreateItemInput, UpdateItemInput } from "../schemas/items.js";
import type * as schema from "../db/schema.js";
import { getAutoMappedStatus, defaultStatusForType } from "./item-type-system.js";
import {
  resolveLinkedInfo,
  resolveLinkedInfoActive,
  type ItemWithLinkedInfo,
} from "./item-enrichment.js";
import { logger } from "./logger.js";
import { escapeFts5Query } from "./fts-utils.js";
import { computeRevision, RevisionMismatchError } from "./revision.js";
import { applyTitleRename, type RenameResult } from "./rename-engine.js";
import { isTitleAvailable, TitleCollisionError } from "./wikilink.js";

// `drizzle()` returns BetterSQLite3Database & { $client: Database } — the
// $client property is added by the factory, not the class. Spell out the
// intersection so callers (rename-engine) can read $client without an
// inline cast every site. Verified against the v0.45 type definitions.
type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
type ActiveRow = typeof itemsActive.$inferSelect;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIKE_SAFE_RE = /^[^%_]{4,36}$/;

/**
 * Server-side reverse-lookup helper. Returns the live vault_files.path for the
 * given sparkle_id, or null if no match exists. Sync (better-sqlite3 is sync).
 *
 * Counterpart to GET /api/vault/by-sparkle-id/:id but callable from server-only
 * code paths (vaultReadonlyResponse, list enrichment) without HTTP round-trip.
 *
 * @param sqlite live better-sqlite3 connection
 * @param id     sparkle_id (UUID)
 * @returns      vault path (e.g. "0_Inbox/Title.md") or null when no row matches
 */
export function getVaultPathBySparkleIdSync(sqlite: Database.Database, id: string): string | null {
  const row = sqlite.prepare("SELECT path FROM vault_files WHERE sparkle_id = ?").get(id) as
    | { path: string }
    | undefined;
  return row?.path ?? null;
}

export function createItem(
  db: DB,
  input: Partial<CreateItemInput> & { title: string } & { is_private?: boolean },
) {
  const now = new Date().toISOString();
  const id = uuidv4();
  const type = input.type ?? "note";
  const status = input.status ?? defaultStatusForType(type);
  const normalizedTitle = input.title.normalize("NFC");

  const values = {
    id,
    // NFC-normalize at write so resolver's LOWER(TRIM(title)) compare lands
    // on canonical form. Without this, a decomposed "Café" stored row never
    // resolves via composed "[[Café]]" input. See I3 in PR1 review.
    title: normalizedTitle,
    type: type as "note" | "todo" | "scratch", // SAFETY: Drizzle enum; validated by caller
    content: input.content ?? "",
    status: status as "fleeting", // SAFETY: Drizzle enum; validated by caller or defaultStatusForType
    priority: type === "scratch" ? null : (input.priority ?? null),
    due: type === "todo" ? (input.due ?? null) : null,
    tags: type === "scratch" ? "[]" : JSON.stringify(input.tags ?? []),
    origin: input.origin ?? "",
    source: input.source ?? null,
    aliases: type === "scratch" ? "[]" : JSON.stringify(input.aliases ?? []),
    linked_note_id: type === "todo" ? (input.linked_note_id ?? null) : null,
    category_id: input.category_id ?? null,
    viewed_at: !input.origin || input.origin === "app" ? now : null,
    is_private: input.is_private ? 1 : 0,
    created: now,
    modified: now,
  };

  // ENG-7 + Pre-PR0e: check title uniqueness and insert inside BEGIN IMMEDIATE
  // so two concurrent writers can't both pass `isTitleAvailable` and both
  // succeed. `未命名` and other allowlist titles bypass the check inside
  // `isTitleAvailable` so duplicate fleeting captures stay legal.
  const tx = db.$client.transaction(() => {
    if (!isTitleAvailable(db.$client, normalizedTitle)) {
      throw new TitleCollisionError(normalizedTitle);
    }
    db.insert(itemsActive)
      .values({ ...values, reindex_dirty: 1 })
      .run();
  });
  tx.immediate();

  return db.select().from(itemsActive).where(eq(itemsActive.id, id)).get()!;
}

/**
 * Cross-table item lookup for API routes. Throws 409 on ambiguous prefix.
 * Returns vault row (origin='vault') if not found in items_active.
 */
export function getItem(
  db: DB,
  id: string,
  enrich = true,
  includePrivate = false,
): ItemWithLinkedInfo | null {
  // Full UUID — exact match (fast path): check active first, fall back to vault
  if (UUID_RE.test(id)) {
    const active = db.select().from(itemsActive).where(eq(itemsActive.id, id)).get() ?? null;
    if (active) {
      if (!includePrivate && active.is_private) return null;
      return resolveLinkedInfo(db, [{ kind: "active", row: active }], enrich, includePrivate)[0]!;
    }
    const vault = db.select().from(itemsVault).where(eq(itemsVault.id, id)).get() ?? null;
    if (!vault) return null;
    if (!includePrivate && vault.is_private) return null;
    return resolveLinkedInfo(db, [{ kind: "vault", row: vault }], enrich, includePrivate)[0]!;
  }

  // Short prefix — LIKE match (hex only, 4–36 chars); search both tables
  if (!LIKE_SAFE_RE.test(id)) return null;

  const activeConditions = [like(itemsActive.id, `${id}%`)];
  if (!includePrivate) activeConditions.push(eq(itemsActive.is_private, 0));
  const activeMatches = db
    .select()
    .from(itemsActive)
    .where(and(...activeConditions))
    .orderBy(asc(itemsActive.id))
    .limit(2)
    .all();

  const vaultConditions = [like(itemsVault.id, `${id}%`)];
  if (!includePrivate) vaultConditions.push(eq(itemsVault.is_private, 0));
  const vaultMatches = db
    .select()
    .from(itemsVault)
    .where(and(...vaultConditions))
    .orderBy(asc(itemsVault.id))
    .limit(2)
    .all();

  const total = activeMatches.length + vaultMatches.length;
  if (total === 0) return null;
  if (total > 1) {
    const allIds = [...activeMatches.map((r) => r.id), ...vaultMatches.map((r) => r.id)];
    const error = new Error(`Ambiguous ID prefix '${id}' matches multiple items`) as Error & {
      status: number;
      matches: string[];
    };
    error.status = 409;
    error.matches = allIds;
    throw error;
  }
  if (activeMatches.length === 1) {
    return resolveLinkedInfo(
      db,
      [{ kind: "active", row: activeMatches[0]! }],
      enrich,
      includePrivate,
    )[0]!;
  }
  return resolveLinkedInfo(
    db,
    [{ kind: "vault", row: vaultMatches[0]! }],
    enrich,
    includePrivate,
  )[0]!;
}

/**
 * Lookup for wikilink resolution (export.ts). Returns null on miss OR collision
 * across either table. Preserves the original 筆記（xxxx） text in the exported
 * markdown rather than picking an arbitrary row on ambiguity.
 */
export function getItemForLookup(
  db: DB,
  shortId: string,
): { id: string; title: string; origin: "active" | "vault" } | null {
  if (!LIKE_SAFE_RE.test(shortId) && !UUID_RE.test(shortId)) return null;
  const activeMatches = db
    .select({ id: itemsActive.id, title: itemsActive.title })
    .from(itemsActive)
    .where(and(like(itemsActive.id, `${shortId}%`), eq(itemsActive.is_private, 0)))
    .limit(2)
    .all();
  const vaultMatches = db
    .select({ id: itemsVault.id, title: itemsVault.title })
    .from(itemsVault)
    .where(and(like(itemsVault.id, `${shortId}%`), eq(itemsVault.is_private, 0)))
    .limit(2)
    .all();
  const total = activeMatches.length + vaultMatches.length;
  if (total !== 1) return null;
  if (activeMatches.length === 1) {
    return { ...activeMatches[0]!, origin: "active" };
  }
  return { ...vaultMatches[0]!, origin: "vault" };
}

export type ListItemsResult = { items: ItemWithLinkedInfo[]; total: number };

export type ListItemsFilters = {
  status?: string;
  excludeStatus?: string[];
  type?: string;
  tag?: string;
  linked_note_id?: string;
  category_id?: string;
  sort?: "created" | "priority" | "due" | "modified";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
  is_private?: 0 | 1;
  paused?: "true" | "false" | "all";
  include_vault?: "true" | "false";
};

export function listItems(db: DB, filters?: ListItemsFilters, enrich = true): ListItemsResult {
  if (filters?.status === "exported") {
    return listVaultItems(
      db,
      {
        category_id: filters.category_id,
        is_private: filters.is_private,
        tag: filters.tag,
        limit: filters.limit,
        offset: filters.offset,
        sort: filters.sort === "created" ? "created" : "exported_at",
        order: filters.order,
      },
      enrich,
    );
  }
  if (filters?.include_vault === "true") {
    return listItemsAcross(db, filters, enrich);
  }
  return listActiveItems(db, filters, enrich);
}

function listActiveItems(
  db: DB,
  filters: ListItemsFilters | undefined,
  enrich: boolean,
): ListItemsResult {
  const conditions = [];

  conditions.push(eq(itemsActive.is_private, filters?.is_private ?? 0));

  if (filters?.paused === "true") {
    conditions.push(eq(itemsActive.paused, 1));
  } else if (filters?.paused !== "all") {
    conditions.push(eq(itemsActive.paused, 0));
  }

  if (filters?.status) {
    // SAFETY: Drizzle requires literal union type; value is validated by Zod in route layer
    conditions.push(eq(itemsActive.status, filters.status as "fleeting"));
  }
  if (filters?.excludeStatus && filters.excludeStatus.length > 0) {
    // SAFETY: Drizzle requires literal union type; values are validated by Zod in route layer
    conditions.push(notInArray(itemsActive.status, filters.excludeStatus as ["fleeting"]));
  }
  if (filters?.type) {
    // SAFETY: Drizzle requires literal union type; value is validated by Zod in route layer
    conditions.push(eq(itemsActive.type, filters.type as "note"));
  }
  if (filters?.linked_note_id) {
    conditions.push(eq(itemsActive.linked_note_id, filters.linked_note_id));
  }
  if (filters?.category_id) {
    conditions.push(eq(itemsActive.category_id, filters.category_id));
  }
  if (filters?.tag) {
    conditions.push(sql`json_each.value = ${filters.tag}`);
  }

  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;
  const sortField = filters?.sort ?? "created";
  const sortOrder = filters?.order ?? "desc";

  const sortColumn =
    sortField === "priority"
      ? itemsActive.priority
      : sortField === "due"
        ? itemsActive.due
        : sortField === "modified"
          ? itemsActive.modified
          : itemsActive.created;
  const orderFn = sortOrder === "asc" ? asc : desc;

  if (filters?.tag) {
    const whereClause = conditions.length > 0 ? sql`WHERE ${and(...conditions)}` : sql``;

    const countResult = db.all<{ count: number }>(
      sql`SELECT COUNT(DISTINCT items_active.id) as count FROM items_active, json_each(items_active.tags) ${whereClause}`,
    );
    const total = countResult[0]?.count ?? 0;

    const orderSql =
      sortOrder === "asc" ? sql`ORDER BY ${sortColumn} ASC` : sql`ORDER BY ${sortColumn} DESC`;

    const rows = db.all<ActiveRow>(
      sql`SELECT DISTINCT items_active.* FROM items_active, json_each(items_active.tags) ${whereClause} ${orderSql} LIMIT ${limit} OFFSET ${offset}`,
    );

    return { items: resolveLinkedInfoActive(db, rows, enrich), total };
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(itemsActive)
    .where(whereClause)
    .get();
  const total = countResult?.count ?? 0;

  const rows = db
    .select()
    .from(itemsActive)
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(limit)
    .offset(offset)
    .all();

  return { items: resolveLinkedInfoActive(db, rows, enrich), total };
}

export function listVaultItems(
  db: DB,
  filters?: {
    category_id?: string;
    is_private?: 0 | 1;
    tag?: string;
    limit?: number;
    offset?: number;
    sort?: "exported_at" | "created";
    order?: "asc" | "desc";
  },
  enrich = true,
): ListItemsResult {
  const conditions = [eq(itemsVault.is_private, filters?.is_private ?? 0)];
  if (filters?.category_id) {
    conditions.push(eq(itemsVault.category_id, filters.category_id));
  }
  if (filters?.tag) {
    conditions.push(sql`json_each.value = ${filters.tag}`);
  }

  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;
  const sortField = filters?.sort ?? "exported_at";
  const sortOrder = filters?.order ?? "desc";
  const sortColumn = sortField === "created" ? itemsVault.created : itemsVault.exported_at;

  type VaultRow = typeof itemsVault.$inferSelect;
  type VaultRowWithPath = VaultRow & { vault_path: string | null };

  if (filters?.tag) {
    const whereClause = sql`WHERE ${and(...conditions)}`;
    const countResult = db.all<{ count: number }>(
      sql`SELECT COUNT(DISTINCT items_vault.id) as count FROM items_vault, json_each(items_vault.tags) ${whereClause}`,
    );
    const total = countResult[0]?.count ?? 0;
    const orderSql =
      sortOrder === "asc" ? sql`ORDER BY ${sortColumn} ASC` : sql`ORDER BY ${sortColumn} DESC`;
    // LEFT JOIN vault_files via partial index idx_vault_files_sparkle_id —
    // hydrates current path per row in one query, eliminating N+1 reverse-lookup
    // for the listing endpoint. Verify EXPLAIN QUERY PLAN if perf regresses.
    const rows = db.all<VaultRowWithPath>(
      sql`SELECT DISTINCT items_vault.*, vf.path AS vault_path
            FROM items_vault, json_each(items_vault.tags)
            LEFT JOIN vault_files vf ON vf.sparkle_id = items_vault.id
            ${whereClause} ${orderSql} LIMIT ${limit} OFFSET ${offset}`,
    );
    return {
      items: resolveLinkedInfo(
        db,
        rows.map(({ vault_path, ...row }) => ({
          kind: "vault" as const,
          row: row as VaultRow,
          vault_path,
        })),
        enrich,
        filters.is_private === 1,
      ),
      total,
    };
  }

  const whereClause = and(...conditions);

  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(itemsVault)
    .where(whereClause)
    .get();
  const total = countResult?.count ?? 0;

  const orderSql =
    sortOrder === "asc" ? sql`ORDER BY ${sortColumn} ASC` : sql`ORDER BY ${sortColumn} DESC`;
  const whereSql = whereClause ? sql`WHERE ${whereClause}` : sql``;
  const rows = db.all<VaultRowWithPath>(
    sql`SELECT items_vault.*, vf.path AS vault_path
          FROM items_vault
          LEFT JOIN vault_files vf ON vf.sparkle_id = items_vault.id
          ${whereSql} ${orderSql} LIMIT ${limit} OFFSET ${offset}`,
  );

  return {
    items: resolveLinkedInfo(
      db,
      rows.map(({ vault_path, ...row }) => ({
        kind: "vault" as const,
        row: row as VaultRow,
        vault_path,
      })),
      enrich,
      filters?.is_private === 1,
    ),
    total,
  };
}

function listItemsAcross(db: DB, filters: ListItemsFilters, enrich: boolean): ListItemsResult {
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  // Over-fetch so the merge window contains the true top-window regardless of
  // how the two tables interleave on the sort key.
  const window = limit + offset;

  const activeResult = listActiveItems(db, { ...filters, limit: window, offset: 0 }, enrich);

  const vaultIncompatible =
    filters.linked_note_id !== undefined ||
    (filters.type !== undefined && filters.type !== "note") ||
    filters.status !== undefined;

  // Align vault's fetch ordering with the caller's sort — otherwise the merge
  // loses top-ranked vault rows.
  const vaultSort: "exported_at" | "created" =
    filters.sort === "created" ? "created" : "exported_at";
  const vaultResult = vaultIncompatible
    ? { items: [] as ItemWithLinkedInfo[], total: 0 }
    : listVaultItems(
        db,
        {
          category_id: filters.category_id,
          is_private: filters.is_private,
          tag: filters.tag,
          limit: window,
          offset: 0,
          sort: vaultSort,
          order: filters.order,
        },
        enrich,
      );

  const sortField = filters.sort ?? "created";
  const descending = (filters.order ?? "desc") === "desc";
  const merged = [...activeResult.items, ...vaultResult.items];
  merged.sort((a, b) => {
    const av = a[sortField];
    const bv = b[sortField];
    if (av == null && bv == null) return 0;
    if (av == null) return descending ? 1 : -1;
    if (bv == null) return descending ? -1 : 1;
    if (av < bv) return descending ? 1 : -1;
    if (av > bv) return descending ? -1 : 1;
    return 0;
  });

  return {
    items: merged.slice(offset, offset + limit),
    total: activeResult.total + vaultResult.total,
  };
}

export function updateItem(
  db: DB,
  id: string,
  input: UpdateItemInput & { is_private?: boolean },
  includePrivate = false,
  prefetchedExisting?: ItemWithLinkedInfo | null,
) {
  const existing =
    prefetchedExisting !== undefined ? prefetchedExisting : getItem(db, id, false, includePrivate);
  if (!existing) return null;

  // Vault-origin items are read-only via this path. Route layer should have
  // already short-circuited with a 409 VAULT_READONLY; this is a defensive layer.
  if (existing.origin === "vault") {
    logger.warn({ id: existing.id }, "Blocked update on vault-origin item");
    return existing;
  }

  // Compare-and-swap on content. Opt-in via `input.revision`; the rename
  // engine (PR3) and MCP edit_note v2 both rely on this guard to detect
  // concurrent edits. Without it, a rename rewriting a source item's
  // content silently clobbers a parallel edit_note save.
  //
  // `existing` may be stale if another connection (e.g. MCP stdio process)
  // committed between the prefetch and now — re-read inside the SQLite write
  // lock. The UPDATE below runs through the same `db` immediately after, so
  // better-sqlite3's per-connection serialization closes the TOCTOU window
  // for same-process callers; cross-process callers (MCP) still race here
  // because WAL allows concurrent writers — see PR3 follow-up for a true
  // BEGIN IMMEDIATE wrap.
  if (input.revision !== undefined) {
    const fresh = db
      .select({ content: itemsActive.content })
      .from(itemsActive)
      .where(eq(itemsActive.id, id))
      .get();
    if (!fresh) return null;
    const currentRevision = computeRevision(fresh.content);
    if (currentRevision !== input.revision) {
      throw new RevisionMismatchError(
        existing.id,
        input.revision,
        currentRevision,
        fresh.content ?? "",
      );
    }
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { modified: now };

  if (input.title !== undefined) updates.title = input.title.normalize("NFC");
  if (input.type !== undefined) updates.type = input.type;
  if (input.content !== undefined) updates.content = input.content;
  if (input.status !== undefined) updates.status = input.status;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.due !== undefined) updates.due = input.due;
  if (input.tags !== undefined) updates.tags = JSON.stringify(input.tags);
  if (input.source !== undefined) updates.source = input.source;
  if (input.aliases !== undefined) updates.aliases = JSON.stringify(input.aliases);
  if (input.linked_note_id !== undefined) updates.linked_note_id = input.linked_note_id;
  if (input.category_id !== undefined) updates.category_id = input.category_id;
  if (input.viewed_at !== undefined) updates.viewed_at = input.viewed_at;
  if (input.is_private !== undefined) updates.is_private = input.is_private ? 1 : 0;

  // Paused flag handling
  if (input.paused === true) {
    updates.paused = 1;
    updates.paused_at = new Date().toISOString();
    if (input.paused_context !== undefined) {
      updates.paused_context = input.paused_context;
    }
  } else if (input.paused === false) {
    updates.paused = 0;
    updates.paused_at = null;
    updates.paused_context = null;
  } else if (input.paused_context !== undefined && existing.paused) {
    updates.paused_context = input.paused_context;
  }

  // Type conversion auto-mapping (Section 9)
  if (input.type !== undefined && input.type !== existing.type) {
    const mappedStatus = getAutoMappedStatus(
      existing.type,
      input.type,
      existing.status ?? "fleeting",
    );
    if (mappedStatus) {
      updates.status = mappedStatus;
    }
  }

  const effectiveType = (updates.type as string) ?? existing.type;

  // Notes don't have linked_note_id; clear on todo→note conversion, ignore for notes
  if (effectiveType === "note") {
    if (input.type !== undefined && input.type !== existing.type) {
      updates.linked_note_id = null;
    } else {
      delete updates.linked_note_id;
    }
  }

  // Notes don't support due dates
  if (effectiveType === "note") {
    if (input.type !== undefined && input.type !== existing.type) {
      updates.due = null;
    } else {
      delete updates.due;
    }
  }

  // Scratch doesn't support tags, priority, due, aliases, linked_note_id
  if (effectiveType === "scratch") {
    if (input.type !== undefined && input.type !== existing.type) {
      updates.tags = "[]";
      updates.priority = null;
      updates.due = null;
      updates.aliases = "[]";
      updates.linked_note_id = null;
    } else {
      delete updates.tags;
      delete updates.priority;
      delete updates.due;
      delete updates.aliases;
      delete updates.linked_note_id;
    }
  }

  // Auto-clear paused when transitioning to archived (exported path is the
  // export flow in routes/items.ts which moves the row to items_vault entirely).
  const finalStatus = (updates.status as string) ?? existing.status;
  if (finalStatus === "archived") {
    updates.paused = 0;
    updates.paused_at = null;
    updates.paused_context = null;
  }

  // Mark dirty when content or title moves — those are the only fields
  // that can change the set of resolved wikilink targets in this row.
  // Status/priority/tag/category changes are not indexed.
  if (input.content !== undefined || input.title !== undefined) {
    updates.reindex_dirty = 1;
  }

  // ENG-7 + Pre-PR0e: when the title is changing to a new value, check
  // uniqueness and apply the UPDATE + rename sweep inside a single
  // BEGIN IMMEDIATE so the check+write is atomic. Two concurrent writers
  // can't both pass the check and both win.
  //
  // When the title isn't changing, fall through to a plain UPDATE — no
  // transaction overhead for the common path.
  const normalizedNewTitle = updates.title as string | undefined;
  const titleIsChanging = normalizedNewTitle !== undefined && normalizedNewTitle !== existing.title;

  let renameResult: RenameResult | null = null;
  if (titleIsChanging) {
    const tx = db.$client.transaction(() => {
      if (!isTitleAvailable(db.$client, normalizedNewTitle!, id)) {
        throw new TitleCollisionError(normalizedNewTitle!);
      }
      db.update(itemsActive).set(updates).where(eq(itemsActive.id, id)).run();
      // First-time title set (existing.title was empty) is not a rename —
      // there are no source references citing an empty title to sweep.
      if (existing.title.trim() !== "") {
        renameResult = applyTitleRename(
          db.$client,
          existing.id,
          existing.title,
          normalizedNewTitle!,
          "user",
          input.expected_state_hash,
        );
      }
    });
    tx.immediate();
  } else {
    db.update(itemsActive).set(updates).where(eq(itemsActive.id, id)).run();
  }

  const item = getItem(db, id, true, includePrivate);
  if (!item) return null;
  // Attach the rename result as a non-enumerable side-channel so the route
  // layer can surface `swept_references` to MCP without breaking other
  // callers that destructure the item by known fields.
  if (renameResult) {
    Object.defineProperty(item, "_rename", {
      value: renameResult,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  return item;
}

/** Helper for the route layer: extract the side-channel rename result if any. */
export function getRenameResultFromItem(item: object | null): RenameResult | null {
  if (!item) return null;
  return (item as { _rename?: RenameResult })._rename ?? null;
}

export function deleteItem(db: DB, id: string): boolean {
  const result = db.delete(itemsActive).where(eq(itemsActive.id, id)).run();
  return result.changes > 0;
}

/**
 * Hard-delete a vault stub row. Returns `{ id, vault_path }` (path is read via
 * vault_files reverse-lookup INSIDE the same transaction, then captured before
 * the row is gone — useful for caller logging / response payload). Returns null
 * if the id was not in items_vault.
 *
 * Atomically nulls vault_files.sparkle_id for the same id so subsequent scanner
 * cycles don't relink the released row to a collided short_id prefix.
 *
 * Does NOT touch todos.linked_note_id — dangling refs are the surface that lets
 * the UI render `linked_note_origin: 'missing'`.
 */
export function deleteVaultItem(
  sqlite: Database.Database,
  id: string,
): { id: string; vault_path: string | null } | null {
  return sqlite.transaction(() => {
    const row = sqlite
      .prepare(
        `SELECT iv.id, vf.path AS vault_path
           FROM items_vault iv
           LEFT JOIN vault_files vf ON vf.sparkle_id = iv.id
          WHERE iv.id = ?`,
      )
      .get(id) as { id: string; vault_path: string | null } | undefined;
    if (!row) return null;
    sqlite.prepare("DELETE FROM items_vault WHERE id = ?").run(id);
    sqlite.prepare("UPDATE vault_files SET sparkle_id = NULL WHERE sparkle_id = ?").run(id);
    return { id: row.id, vault_path: row.vault_path };
  })();
}

/**
 * Match any `id:<token>` query. Token is captured permissively (`\S+`) so that
 * invalid IDs still take the strict-ID path and return 0 results instead of
 * silently falling through to FTS — that fallback would surprise users who
 * meant "find this exact ID."
 *
 * Mirror this when changing it: `mcp-server/src/tools/search.ts` keeps a
 * matching predicate to skip the vault filesystem search for ID queries.
 */
export const ID_PREFIX_QUERY_RE = /^id:\s*(\S+)\s*$/i;

/** Strict hex prefix (no dashes). UUID hex run is 32 chars, so cap at 32. */
const HEX_PREFIX_RE = /^[0-9a-f]{4,32}$/i;

/**
 * Rebuild canonical UUID dash positions (8-4-4-4-12) from a dash-stripped
 * hex prefix so GLOB matches stored IDs (which always carry dashes).
 *   'abc12345'         → 'abc12345'
 *   'abc123451111'     → 'abc12345-1111'
 *   '<32 hex chars>'   → canonical 36-char UUID
 * Caller has already validated input is 4–32 lowercase hex chars.
 */
function reconstructUuidPrefix(stripped: string): string {
  const segments = [8, 4, 4, 4, 12];
  let result = "";
  let consumed = 0;
  for (const seg of segments) {
    const take = Math.min(stripped.length - consumed, seg);
    if (take <= 0) break;
    if (consumed > 0) result += "-";
    result += stripped.slice(consumed, consumed + take);
    consumed += take;
  }
  return result;
}

/**
 * Cross-table ID lookup for the `id:<prefix>` search syntax. Returns full UUID
 * exact matches and short hex prefix matches across items_active + items_vault.
 * Invalid prefixes (non-hex chars, < 4 chars) return [] without an FTS fallback.
 */
function searchItemsByIdPrefix(
  db: DB,
  id: string,
  enrich: boolean,
  includePrivate: boolean | "only",
  limit: number,
): ItemWithLinkedInfo[] {
  if (!id) return [];

  const privacyConds = (table: typeof itemsActive | typeof itemsVault) => {
    if (includePrivate === "only") return [eq(table.is_private, 1)];
    if (includePrivate === true) return [];
    return [eq(table.is_private, 0)];
  };
  const enrichIncludePrivate = includePrivate === true || includePrivate === "only";

  if (UUID_RE.test(id)) {
    const active = db
      .select()
      .from(itemsActive)
      .where(and(eq(itemsActive.id, id), ...privacyConds(itemsActive)))
      .get();
    if (active) {
      return resolveLinkedInfo(db, [{ kind: "active", row: active }], enrich, enrichIncludePrivate);
    }
    const vault = db
      .select()
      .from(itemsVault)
      .where(and(eq(itemsVault.id, id), ...privacyConds(itemsVault)))
      .get();
    if (!vault) return [];
    return resolveLinkedInfo(db, [{ kind: "vault", row: vault }], enrich, enrichIncludePrivate);
  }

  // Tolerate user-pasted prefixes that include UUID dashes (highlight-and-copy
  // from the item-detail tooltip is a natural source). Strip dashes, validate
  // the hex run, then rebuild canonical UUID-segment shape so the GLOB pattern
  // matches stored IDs (dashes at positions 8/13/18/23).
  const stripped = id.replace(/-/g, "");
  if (!HEX_PREFIX_RE.test(stripped)) return [];

  // GLOB instead of LIKE: SQLite's `case_sensitive_like=OFF` default + BINARY-collated
  // text PRIMARY KEY means `id LIKE 'prefix%'` falls back to SCAN, while
  // `id GLOB 'prefix*'` is case-sensitive and uses the PK index (verified via
  // EXPLAIN QUERY PLAN). Prefix is hex-only and pre-lowercased, so no metachar risk.
  const globPattern = `${reconstructUuidPrefix(stripped)}*`;

  const activeRows = db
    .select()
    .from(itemsActive)
    .where(and(sql`${itemsActive.id} GLOB ${globPattern}`, ...privacyConds(itemsActive)))
    .orderBy(asc(itemsActive.id))
    .limit(limit)
    .all();

  const remaining = limit - activeRows.length;
  const vaultRows =
    remaining > 0
      ? db
          .select()
          .from(itemsVault)
          .where(and(sql`${itemsVault.id} GLOB ${globPattern}`, ...privacyConds(itemsVault)))
          .orderBy(asc(itemsVault.id))
          .limit(remaining)
          .all()
      : [];

  const sources = [
    ...activeRows.map((row) => ({ kind: "active" as const, row })),
    ...vaultRows.map((row) => ({ kind: "vault" as const, row })),
  ];
  if (sources.length === 0) return [];
  return resolveLinkedInfo(db, sources, enrich, enrichIncludePrivate);
}

export function searchItems(
  sqlite: Database.Database,
  db: DB,
  query: string,
  limit = 20,
  enrich = true,
  includePrivate: boolean | "only" = false,
): ItemWithLinkedInfo[] {
  // No FTS fallback for `id:` queries — user explicitly asked for an ID match.
  const idMatch = query.trim().match(ID_PREFIX_QUERY_RE);
  if (idMatch) {
    const idPart = idMatch[1]!.toLowerCase();
    return searchItemsByIdPrefix(db, idPart, enrich, includePrivate, limit);
  }

  const privateClause =
    includePrivate === "only"
      ? "AND items_active.is_private = 1"
      : includePrivate
        ? ""
        : "AND items_active.is_private = 0";

  // Trigram tokenizer requires at least 3 characters; fall back to LIKE for shorter queries
  if (query.length < 3) {
    const pattern = `%${query}%`;
    const stmt = sqlite.prepare(`
      SELECT * FROM items_active
      WHERE (title LIKE ? OR content LIKE ?) ${privateClause}
      ORDER BY created DESC
      LIMIT ?
    `);
    // SAFETY: better-sqlite3 returns unknown[]; columns match items_active schema by migration
    const rows = stmt.all(pattern, pattern, limit) as ActiveRow[];
    return resolveLinkedInfoActive(db, rows, enrich, !!includePrivate);
  }

  const escaped = escapeFts5Query(query);
  const stmt = sqlite.prepare(`
    SELECT items_active.*
    FROM items_active_fts
    JOIN items_active ON items_active.rowid = items_active_fts.rowid
    WHERE items_active_fts MATCH ? ${privateClause}
    ORDER BY rank
    LIMIT ?
  `);

  // SAFETY: better-sqlite3 returns unknown[]; columns match items_active schema by migration
  const rows = stmt.all(escaped, limit) as ActiveRow[];
  return resolveLinkedInfoActive(db, rows, enrich, !!includePrivate);
}

export function getAllTags(sqlite: Database.Database, includePrivate = false): string[] {
  const privateClause = includePrivate ? "" : "AND items_active.is_private = 0";
  const stmt = sqlite.prepare(`
    SELECT DISTINCT value as tag
    FROM items_active, json_each(items_active.tags)
    WHERE value != '' ${privateClause}
    ORDER BY value
  `);

  // SAFETY: better-sqlite3 returns unknown[]; single-column query result
  const rows = stmt.all() as { tag: string }[];
  return rows.map((r) => r.tag);
}
