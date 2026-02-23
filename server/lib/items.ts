import { eq, desc, asc, sql, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { items } from "../db/schema.js";
import type { CreateItemInput, UpdateItemInput } from "../schemas/items.js";
import type * as schema from "../db/schema.js";

type DB = BetterSQLite3Database<typeof schema>;

export function createItem(
  db: DB,
  input: Partial<CreateItemInput> & { title: string },
) {
  const now = new Date().toISOString();
  const id = uuidv4();

  const values = {
    id,
    title: input.title,
    type: input.type ?? ("note" as const),
    content: input.content ?? "",
    status: input.status ?? ("inbox" as const),
    priority: input.priority ?? null,
    due_date: input.due_date ?? null,
    tags: JSON.stringify(input.tags ?? []),
    source: input.source ?? "",
    created_at: now,
    updated_at: now,
  };

  db.insert(items).values(values).run();
  return db.select().from(items).where(eq(items.id, id)).get()!;
}

export function getItem(db: DB, id: string) {
  return db.select().from(items).where(eq(items.id, id)).get() ?? null;
}

export function listItems(
  db: DB,
  filters?: {
    status?: string;
    type?: string;
    tag?: string;
    sort?: "created_at" | "priority" | "due_date";
    order?: "asc" | "desc";
    limit?: number;
    offset?: number;
  },
) {
  const conditions = [];

  if (filters?.status) {
    conditions.push(eq(items.status, filters.status as "inbox"));
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
  const sortField = filters?.sort ?? "created_at";
  const sortOrder = filters?.order ?? "desc";

  const sortColumn = sortField === "priority" ? items.priority
    : sortField === "due_date" ? items.due_date
    : items.created_at;
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

    return { items: rows, total };
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

  return { items: rows, total };
}

export function updateItem(db: DB, id: string, input: UpdateItemInput) {
  const existing = getItem(db, id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updated_at: now };

  if (input.title !== undefined) updates.title = input.title;
  if (input.type !== undefined) updates.type = input.type;
  if (input.content !== undefined) updates.content = input.content;
  if (input.status !== undefined) updates.status = input.status;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.due_date !== undefined) updates.due_date = input.due_date;
  if (input.tags !== undefined) updates.tags = JSON.stringify(input.tags);
  if (input.source !== undefined) updates.source = input.source;

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
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(pattern, pattern, limit) as (typeof items.$inferSelect)[];
  }

  const stmt = sqlite.prepare(`
    SELECT items.*
    FROM items_fts
    JOIN items ON items.rowid = items_fts.rowid
    WHERE items_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);

  return stmt.all(query, limit) as (typeof items.$inferSelect)[];
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
