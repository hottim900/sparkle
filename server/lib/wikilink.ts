// Server-side wikilink resolver + reference_index maintenance.
//
// Parser lives in src/lib/wikilink.ts (shared with the frontend renderer);
// this module adds the DB-aware parts: title→id resolution, application-layer
// title uniqueness check (Pre-PR0e spec), and reindex_dirty draining.
//
// Spec: docs/wikilink-spec.md

import type Database from "better-sqlite3";
import {
  parseWikilinks,
  normalizeTitleForUniqueness,
  isTitleInAllowlist,
} from "../../src/lib/wikilink.js";

/** Legacy `筆記（xxxxxxxx）` reference. Indexed as `kind='legacy_hex'` so the
 *  rename engine can choose to leave them alone (they target by short id, not
 *  by title) and the backfill migration (PR 4) can locate every site to rewrite. */
const LEGACY_HEX_RE = /筆記（([0-9a-f]{4,8})）/g;

/** Result of resolving `[[Title]]` to a concrete item.
 *  `null` is returned on miss OR collision (multiple active matches) — the
 *  renderer treats both the same (unresolved purple). */
export interface ResolvedWikilink {
  id: string;
  title: string;
  origin: "active" | "vault";
}

/**
 * Resolve `[[Title]]` to an item id. Honors the Pre-PR0e priority rule:
 *
 *   1. items_active match (any) wins over items_vault.
 *   2. Multiple active matches → null (collision, e.g. two `未命名`).
 *   3. No active match + single vault match → return vault row.
 *   4. No active match + multiple vault matches → null.
 *
 * Normalization: NFC + trim + ASCII lowercase (CJK case-sensitive).
 * Always reads `is_private = 0` rows — private items are never resolvable from
 * a wikilink in shared/public surfaces. Callers needing private resolution
 * should pass `includePrivate = true` explicitly.
 */
export function resolveWikilinkTitle(
  sqlite: Database.Database,
  rawTitle: string,
  opts: { includePrivate?: boolean } = {},
): ResolvedWikilink | null {
  const normalized = normalizeTitleForUniqueness(rawTitle);
  if (normalized === "") return null;
  if (isTitleInAllowlist(rawTitle)) {
    // Allowlist titles are ambiguous by construction (multiple `未命名` rows
    // are legitimate). Resolver returns null → renderer shows unresolved.
    return null;
  }

  const privacy = opts.includePrivate ? "" : "AND is_private = 0";

  // Active first. LIMIT 2 so we detect collisions without scanning the full table.
  const activeRows = sqlite
    .prepare(
      `SELECT id, title FROM items_active
        WHERE LOWER(TRIM(title)) = ? ${privacy}
        LIMIT 2`,
    )
    .all(normalized) as { id: string; title: string }[];

  if (activeRows.length > 1) return null;
  if (activeRows.length === 1) {
    return { id: activeRows[0]!.id, title: activeRows[0]!.title, origin: "active" };
  }

  const vaultRows = sqlite
    .prepare(
      `SELECT id, title FROM items_vault
        WHERE LOWER(TRIM(title)) = ? ${privacy}
        LIMIT 2`,
    )
    .all(normalized) as { id: string; title: string }[];

  if (vaultRows.length !== 1) return null;
  return { id: vaultRows[0]!.id, title: vaultRows[0]!.title, origin: "vault" };
}

/**
 * Application-layer title uniqueness check per Pre-PR0e.
 *
 * Returns `true` if the title can be claimed (or is already held by `exceptId`).
 * Allowlist titles (`未命名`) always return `true` — duplicate fleeting captures
 * must not be blocked.
 *
 * Scope: items_active only. Vault titles are explicitly NOT in scope; the
 * resolver tolerates vault collisions by returning null.
 *
 * IMPORTANT: this is a read-then-write check, not atomic. PR 1 callers wrap
 * the check + insert in a `BEGIN IMMEDIATE` transaction to close the race
 * window — see ENG-7 in docs/wikilink-spec.md. Two concurrent writers without
 * the wrap would both see "available" and both insert, defeating uniqueness.
 */
export function isTitleAvailable(
  sqlite: Database.Database,
  rawTitle: string,
  exceptId?: string,
): boolean {
  if (isTitleInAllowlist(rawTitle)) return true;
  const normalized = normalizeTitleForUniqueness(rawTitle);
  if (normalized === "") return true; // empty isn't subject to uniqueness

  const row = exceptId
    ? sqlite
        .prepare(
          `SELECT id FROM items_active
            WHERE LOWER(TRIM(title)) = ? AND id != ?
            LIMIT 1`,
        )
        .get(normalized, exceptId)
    : sqlite
        .prepare(
          `SELECT id FROM items_active
            WHERE LOWER(TRIM(title)) = ?
            LIMIT 1`,
        )
        .get(normalized);
  return !row;
}

/** Structured error thrown by createItem/updateItem when the title check fails.
 *  Route layer catches and returns 409 with `code: "TITLE_COLLISION"`. */
export class TitleCollisionError extends Error {
  readonly code = "TITLE_COLLISION" as const;
  constructor(
    public readonly attemptedTitle: string,
    public readonly conflictingId?: string,
  ) {
    super(
      `Title "${attemptedTitle}" already exists in items_active${
        conflictingId ? ` (conflicting row: ${conflictingId})` : ""
      }`,
    );
    this.name = "TitleCollisionError";
  }
}

/**
 * Mark items_active.reindex_dirty = 1 for the given ids. Called after any
 * content mutation so the background worker (server/lib/wikilink-worker.ts)
 * picks them up on the next 60s cycle.
 *
 * Bulk-friendly: takes an array, single prepared statement. Silently skips
 * ids that don't exist (no row affected → no churn, no error). The dirty
 * column update does NOT fire the FTS trigger (narrowed to title, content
 * since Pre-PR0a) so this is essentially free except for the page write.
 */
export function markItemReindexDirty(sqlite: Database.Database, ids: string[]): number {
  if (ids.length === 0) return 0;
  // Build placeholder list; SQLite parameter binding caps at SQLITE_LIMIT_VARIABLE_NUMBER
  // (default 32766), well above any realistic batch — bulk operations process at most
  // a few hundred ids per call.
  const placeholders = ids.map(() => "?").join(",");
  const stmt = sqlite.prepare(
    `UPDATE items_active SET reindex_dirty = 1 WHERE id IN (${placeholders})`,
  );
  return stmt.run(...ids).changes;
}

/**
 * Rebuild the reference_index rows for a single source. Deletes existing
 * rows for source_id, parses content, inserts fresh rows for every
 * resolved wikilink + every legacy hex reference.
 *
 * Caller controls when this runs: the background worker batches dirty ids
 * (per-source transaction so a single bad row doesn't block the queue),
 * the admin rebuild endpoint loops over all ids (single tx for atomicity).
 *
 * Unresolved wikilinks are NOT indexed — the row simply has no entry for
 * that target. The renderer queries the resolver per render, not the index,
 * so an unindexed link still renders correctly (purple). The index exists
 * purely for the reverse-lookup the rename engine needs.
 */
export function reindexItemReferences(sqlite: Database.Database, sourceId: string): void {
  const row = sqlite.prepare("SELECT content FROM items_active WHERE id = ?").get(sourceId) as
    | { content: string | null }
    | undefined;
  if (!row) return;

  const content = row.content ?? "";
  const wikilinks = parseWikilinks(content);
  const legacyMatches = findLegacyHexMatches(content);

  // Memoize resolves per unique normalized title — a hub note that links to
  // "Foo" 50 times only pays one resolver round-trip. Same for legacy hex.
  const titleCache = new Map<string, ResolvedWikilink | null>();
  const hexCache = new Map<string, { id: string } | null>();

  const tx = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM reference_index WHERE source_id = ?").run(sourceId);
    const insert = sqlite.prepare(
      `INSERT INTO reference_index (source_id, target_id, char_offset, raw_title, kind)
       VALUES (?, ?, ?, ?, ?)`,
    );

    for (const link of wikilinks) {
      const key = normalizeTitleForUniqueness(link.title);
      let resolved = titleCache.get(key);
      if (resolved === undefined) {
        resolved = resolveWikilinkTitle(sqlite, link.title);
        titleCache.set(key, resolved);
      }
      if (!resolved) continue;
      insert.run(sourceId, resolved.id, link.start, link.title, "wikilink");
    }

    for (const match of legacyMatches) {
      let resolved = hexCache.get(match.shortId);
      if (resolved === undefined) {
        resolved = resolveLegacyHex(sqlite, match.shortId);
        hexCache.set(match.shortId, resolved);
      }
      if (!resolved) continue;
      insert.run(sourceId, resolved.id, match.start, match.shortId, "legacy_hex");
    }

    sqlite.prepare("UPDATE items_active SET reindex_dirty = 0 WHERE id = ?").run(sourceId);
  });
  tx();
}

interface LegacyHexMatch {
  shortId: string;
  start: number;
  length: number;
}

/** Scan content for `筆記（xxxx）` legacy references. Used during reindex
 *  so the rename engine and PR 4's backfill can find every legacy site. */
function findLegacyHexMatches(content: string): LegacyHexMatch[] {
  const out: LegacyHexMatch[] = [];
  LEGACY_HEX_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LEGACY_HEX_RE.exec(content)) !== null) {
    out.push({ shortId: m[1]!, start: m.index, length: m[0].length });
  }
  return out;
}

/** Resolve a `筆記（xxxxxxxx）` short hex to an item (active priority).
 *  Returns null on miss or ambiguous prefix. Matches the public surface of
 *  the existing legacy resolver in server/lib/export.ts for parity.
 *
 *  Intentionally duplicates the LIKE-prefix shape of `getItemForLookup` in
 *  server/lib/items.ts — sharing the helper would require plumbing the
 *  Drizzle db handle through worker → drainReindexQueue → reindex, three
 *  layers up. The legacy surface retires in PR 4's backfill migration, so
 *  the duplication is bounded. */
function resolveLegacyHex(
  sqlite: Database.Database,
  shortId: string,
): { id: string; origin: "active" | "vault" } | null {
  const pattern = `${shortId}%`;
  const activeRows = sqlite
    .prepare("SELECT id FROM items_active WHERE id LIKE ? AND is_private = 0 LIMIT 2")
    .all(pattern) as { id: string }[];
  if (activeRows.length > 1) return null;
  if (activeRows.length === 1) return { id: activeRows[0]!.id, origin: "active" };

  const vaultRows = sqlite
    .prepare("SELECT id FROM items_vault WHERE id LIKE ? AND is_private = 0 LIMIT 2")
    .all(pattern) as { id: string }[];
  if (vaultRows.length !== 1) return null;
  return { id: vaultRows[0]!.id, origin: "vault" };
}

/**
 * Drain N dirty rows in one call. Used by the background worker and the
 * admin rebuild endpoint. Returns the number of rows reindexed.
 *
 * Each reindex is its own tx so a single malformed row (e.g. a giant content
 * blob that hits prepared-statement limits) doesn't block the queue — the
 * row stays dirty and the next cycle retries; on persistent failure the
 * operator sees the dirty count plateau in the admin UI (PR 3).
 */
export function drainReindexQueue(sqlite: Database.Database, limit = 50): number {
  const dirty = sqlite
    .prepare("SELECT id FROM items_active WHERE reindex_dirty = 1 LIMIT ?")
    .all(limit) as { id: string }[];
  let count = 0;
  for (const { id } of dirty) {
    try {
      reindexItemReferences(sqlite, id);
      count++;
    } catch {
      // Leave dirty; next cycle retries. Worker logs aggregate at end of cycle.
    }
  }
  return count;
}
