import { eq, desc, asc, sql, and, notInArray, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { items, shareTokens } from "../db/schema.js";
import type { CreateItemInput, UpdateItemInput } from "../schemas/items.js";
import type * as schema from "../db/schema.js";

type DB = BetterSQLite3Database<typeof schema>;

const NOTE_STATUSES = ["fleeting", "developing", "permanent", "exported", "archived"] as const;
const TODO_STATUSES = ["active", "done", "archived"] as const;
const SCRATCH_STATUSES = ["draft", "archived"] as const;

export function isValidTypeStatus(type: string, status: string): boolean {
  if (type === "note") return (NOTE_STATUSES as readonly string[]).includes(status);
  if (type === "todo") return (TODO_STATUSES as readonly string[]).includes(status);
  if (type === "scratch") return (SCRATCH_STATUSES as readonly string[]).includes(status);
  return false;
}

const TYPE_CONVERSION_MAP: Record<string, Record<string, string>> = {
  "todo→note": {
    active: "fleeting",
    done: "permanent",
    archived: "archived",
  },
  "note→todo": {
    fleeting: "active",
    developing: "active",
    permanent: "done",
    exported: "done",
    archived: "archived",
  },
  "scratch→note": {
    draft: "fleeting",
    archived: "archived",
  },
  "scratch→todo": {
    draft: "active",
    archived: "archived",
  },
  "note→scratch": {
    fleeting: "draft",
    developing: "draft",
    permanent: "archived",
    exported: "archived",
    archived: "archived",
  },
  "todo→scratch": {
    active: "draft",
    done: "archived",
    archived: "archived",
  },
};

export function getAutoMappedStatus(
  fromType: string,
  toType: string,
  currentStatus: string,
): string | null {
  if (fromType === toType) return null;
  const key = `${fromType}→${toType}`;
  return TYPE_CONVERSION_MAP[key]?.[currentStatus] ?? null;
}

function defaultStatusForType(type: string): string {
  if (type === "todo") return "active";
  if (type === "scratch") return "draft";
  return "fleeting";
}

export type ItemWithLinkedInfo = typeof items.$inferSelect & {
  linked_note_title: string | null;
  linked_todo_count: number;
  share_visibility: "public" | "unlisted" | null;
};

function resolveLinkedInfo(
  db: DB,
  rows: (typeof items.$inferSelect)[],
): ItemWithLinkedInfo[] {
  // Resolve linked_note_title for todos
  const linkedIds = rows
    .map((r) => r.linked_note_id)
    .filter((id): id is string => id != null);

  const titleMap = new Map<string, string>();
  if (linkedIds.length > 0) {
    const uniqueIds = [...new Set(linkedIds)];
    const linkedItems = db
      .select({ id: items.id, title: items.title })
      .from(items)
      .where(inArray(items.id, uniqueIds))
      .all();
    for (const li of linkedItems) {
      titleMap.set(li.id, li.title);
    }
  }

  // Resolve linked_todo_count for notes
  const noteIds = rows
    .filter((r) => r.type === "note")
    .map((r) => r.id);

  const countMap = new Map<string, number>();
  if (noteIds.length > 0) {
    const uniqueNoteIds = [...new Set(noteIds)];
    const counts = db
      .select({
        linked_note_id: items.linked_note_id,
        count: sql<number>`count(*)`,
      })
      .from(items)
      .where(
        and(
          inArray(items.linked_note_id, uniqueNoteIds),
          sql`${items.status} != 'archived'`,
        ),
      )
      .groupBy(items.linked_note_id)
      .all();
    for (const c of counts) {
      if (c.linked_note_id) {
        countMap.set(c.linked_note_id, c.count);
      }
    }
  }

  // Resolve share_visibility for all items
  const allIds = rows.map((r) => r.id);
  const shareMap = new Map<string, "public" | "unlisted">();
  if (allIds.length > 0) {
    const uniqueAllIds = [...new Set(allIds)];
    const shareRows = db
      .select({
        item_id: shareTokens.item_id,
        has_public: sql<number>`MAX(CASE WHEN ${shareTokens.visibility} = 'public' THEN 1 ELSE 0 END)`,
      })
      .from(shareTokens)
      .where(inArray(shareTokens.item_id, uniqueAllIds))
      .groupBy(shareTokens.item_id)
      .all();
    for (const sr of shareRows) {
      shareMap.set(sr.item_id, sr.has_public ? "public" : "unlisted");
    }
  }

  return rows.map((row) => ({
    ...row,
    linked_note_title: row.linked_note_id
      ? (titleMap.get(row.linked_note_id) ?? null)
      : null,
    linked_todo_count: row.type === "note" ? (countMap.get(row.id) ?? 0) : 0,
    share_visibility: shareMap.get(row.id) ?? null,
  }));
}

export function createItem(
  db: DB,
  input: Partial<CreateItemInput> & { title: string },
) {
  const now = new Date().toISOString();
  const id = uuidv4();
  const type = input.type ?? "note";
  const status = input.status ?? defaultStatusForType(type);

  const values = {
    id,
    title: input.title,
    type: type as "note" | "todo" | "scratch",
    content: input.content ?? "",
    status: status as "fleeting",
    priority: type === "scratch" ? null : (input.priority ?? null),
    due: type === "todo" ? (input.due ?? null) : null,
    tags: type === "scratch" ? "[]" : JSON.stringify(input.tags ?? []),
    origin: input.origin ?? "",
    source: input.source ?? null,
    aliases: type === "scratch" ? "[]" : JSON.stringify(input.aliases ?? []),
    linked_note_id: type === "todo" ? (input.linked_note_id ?? null) : null,
    created: now,
    modified: now,
  };

  db.insert(items).values(values).run();
  return db.select().from(items).where(eq(items.id, id)).get()!;
}

export function getItem(db: DB, id: string): ItemWithLinkedInfo | null {
  const row = db.select().from(items).where(eq(items.id, id)).get() ?? null;
  if (!row) return null;
  return resolveLinkedInfo(db, [row])[0]!;
}

export function listItems(
  db: DB,
  filters?: {
    status?: string;
    excludeStatus?: string[];
    type?: string;
    tag?: string;
    sort?: "created" | "priority" | "due" | "modified";
    order?: "asc" | "desc";
    limit?: number;
    offset?: number;
  },
) {
  const conditions = [];

  if (filters?.status) {
    conditions.push(eq(items.status, filters.status as "fleeting"));
  }
  if (filters?.excludeStatus && filters.excludeStatus.length > 0) {
    conditions.push(
      notInArray(items.status, filters.excludeStatus as ["fleeting"]),
    );
  }
  if (filters?.type) {
    conditions.push(eq(items.type, filters.type as "note"));
  }
  if (filters?.tag) {
    conditions.push(
      sql`json_each.value = ${filters.tag}`,
    );
  }

  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;
  const sortField = filters?.sort ?? "created";
  const sortOrder = filters?.order ?? "desc";

  const sortColumn = sortField === "priority" ? items.priority
    : sortField === "due" ? items.due
    : sortField === "modified" ? items.modified
    : items.created;
  const orderFn = sortOrder === "asc" ? asc : desc;

  if (filters?.tag) {
    const whereClause = conditions.length > 0
      ? sql`WHERE ${and(...conditions)}`
      : sql``;

    const countResult = db.all<{ count: number }>(
      sql`SELECT COUNT(DISTINCT items.id) as count FROM items, json_each(items.tags) ${whereClause}`,
    );
    const total = countResult[0]?.count ?? 0;

    const orderSql = sortOrder === "asc"
      ? sql`ORDER BY items.${sql.raw(sortField)} ASC`
      : sql`ORDER BY items.${sql.raw(sortField)} DESC`;

    const rows = db.all<typeof items.$inferSelect>(
      sql`SELECT DISTINCT items.* FROM items, json_each(items.tags) ${whereClause} ${orderSql} LIMIT ${limit} OFFSET ${offset}`,
    );

    return { items: resolveLinkedInfo(db, rows), total };
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = db
    .select({ count: sql<number>`count(*)` })
    .from(items)
    .where(whereClause)
    .get();
  const total = countResult?.count ?? 0;

  const rows = db
    .select()
    .from(items)
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(limit)
    .offset(offset)
    .all();

  return { items: resolveLinkedInfo(db, rows), total };
}

export function updateItem(db: DB, id: string, input: UpdateItemInput) {
  const existing = getItem(db, id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { modified: now };

  if (input.title !== undefined) updates.title = input.title;
  if (input.type !== undefined) updates.type = input.type;
  if (input.content !== undefined) updates.content = input.content;
  if (input.status !== undefined) updates.status = input.status;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.due !== undefined) updates.due = input.due;
  if (input.tags !== undefined) updates.tags = JSON.stringify(input.tags);
  if (input.source !== undefined) updates.source = input.source;
  if (input.aliases !== undefined) updates.aliases = JSON.stringify(input.aliases);
  if (input.linked_note_id !== undefined) updates.linked_note_id = input.linked_note_id;

  // Type conversion auto-mapping (Section 9)
  if (input.type !== undefined && input.type !== existing.type) {
    const mappedStatus = getAutoMappedStatus(existing.type, input.type, existing.status);
    if (mappedStatus) {
      updates.status = mappedStatus;
    }
  }

  // Exported note auto-reversion (Section 3)
  const effectiveType = (updates.type as string) ?? existing.type;
  const effectiveStatus = (updates.status as string) ?? existing.status;
  if (effectiveType === "note" && effectiveStatus === "exported") {
    const titleChanged = input.title !== undefined && input.title !== existing.title;
    const contentChanged = input.content !== undefined && input.content !== existing.content;
    if (titleChanged || contentChanged) {
      updates.status = "permanent";
    }
  }

  // Notes don't have linked_note_id; clear on todo→note conversion, ignore for notes
  if (effectiveType === "note") {
    if (input.type !== undefined && input.type !== existing.type) {
      // Converting to note: explicitly clear linked_note_id
      updates.linked_note_id = null;
    } else {
      // Already a note: ignore any linked_note_id update
      delete updates.linked_note_id;
    }
  }

  // Notes don't support due dates — clear due on todo→note conversion, ignore due updates for notes
  if (effectiveType === "note") {
    if (input.type !== undefined && input.type !== existing.type) {
      // Converting to note: explicitly clear existing due
      updates.due = null;
    } else {
      // Already a note: ignore any due update attempt
      delete updates.due;
    }
  }

  // Scratch doesn't support tags, priority, due, aliases, linked_note_id
  if (effectiveType === "scratch") {
    if (input.type !== undefined && input.type !== existing.type) {
      // Converting to scratch: clear all unsupported fields
      updates.tags = "[]";
      updates.priority = null;
      updates.due = null;
      updates.aliases = "[]";
      updates.linked_note_id = null;
    } else {
      // Already a scratch: ignore updates to unsupported fields
      delete updates.tags;
      delete updates.priority;
      delete updates.due;
      delete updates.aliases;
      delete updates.linked_note_id;
    }
  }

  db.update(items)
    .set(updates)
    .where(eq(items.id, id))
    .run();

  return getItem(db, id);
}

export function deleteItem(db: DB, id: string): boolean {
  const result = db.delete(items).where(eq(items.id, id)).run();
  return result.changes > 0;
}

/**
 * Escape user input for FTS5 MATCH. Each token is wrapped in double-quotes
 * (phrase literal) to prevent FTS5 syntax characters from being interpreted.
 * Multiple tokens are AND-joined so all must match.
 * Embedded double-quotes are doubled per FTS5 syntax.
 */
function escapeFts5Query(raw: string): string {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND ");
}

export function searchItems(
  sqlite: Database.Database,
  query: string,
  limit = 20,
) {
  // Trigram tokenizer requires at least 3 characters; fall back to LIKE for shorter queries
  if (query.length < 3) {
    const pattern = `%${query}%`;
    const stmt = sqlite.prepare(`
      SELECT * FROM items
      WHERE title LIKE ? OR content LIKE ?
      ORDER BY created DESC
      LIMIT ?
    `);
    return stmt.all(pattern, pattern, limit) as (typeof items.$inferSelect)[];
  }

  const escaped = escapeFts5Query(query);
  const stmt = sqlite.prepare(`
    SELECT items.*
    FROM items_fts
    JOIN items ON items.rowid = items_fts.rowid
    WHERE items_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);

  return stmt.all(escaped, limit) as (typeof items.$inferSelect)[];
}

export function getAllTags(sqlite: Database.Database): string[] {
  const stmt = sqlite.prepare(`
    SELECT DISTINCT value as tag
    FROM items, json_each(items.tags)
    WHERE value != ''
    ORDER BY value
  `);

  const rows = stmt.all() as { tag: string }[];
  return rows.map((r) => r.tag);
}
