import { sql, inArray, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { items, shareTokens, categories } from "../db/schema.js";
import type * as schema from "../db/schema.js";

type DB = BetterSQLite3Database<typeof schema>;

export type ItemWithLinkedInfo = typeof items.$inferSelect & {
  linked_note_title: string | null;
  linked_todo_count: number;
  share_visibility: "public" | "unlisted" | null;
  category_name: string | null;
};

export function resolveLinkedInfo(
  db: DB,
  rows: (typeof items.$inferSelect)[],
  enrich = true,
): ItemWithLinkedInfo[] {
  if (rows.length === 0) return [];

  if (!enrich) {
    return rows.map((row) => ({
      ...row,
      linked_note_title: null,
      linked_todo_count: 0,
      share_visibility: null,
      category_name: null,
    }));
  }

  // Resolve linked_note_title for todos
  const linkedIds = rows.map((r) => r.linked_note_id).filter((id): id is string => id != null);

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
  const noteIds = rows.filter((r) => r.type === "note").map((r) => r.id);

  const countMap = new Map<string, number>();
  if (noteIds.length > 0) {
    const uniqueNoteIds = [...new Set(noteIds)];
    const counts = db
      .select({
        linked_note_id: items.linked_note_id,
        count: sql<number>`count(*)`,
      })
      .from(items)
      .where(and(inArray(items.linked_note_id, uniqueNoteIds), sql`${items.status} != 'archived'`))
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

  // Resolve category_name for all items
  const categoryIds = rows.map((r) => r.category_id).filter((id): id is string => id != null);
  const categoryNameMap = new Map<string, string>();
  if (categoryIds.length > 0) {
    const uniqueCatIds = [...new Set(categoryIds)];
    const catRows = db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(inArray(categories.id, uniqueCatIds))
      .all();
    for (const cr of catRows) {
      categoryNameMap.set(cr.id, cr.name);
    }
  }

  return rows.map((row) => ({
    ...row,
    linked_note_title: row.linked_note_id ? (titleMap.get(row.linked_note_id) ?? null) : null,
    linked_todo_count: row.type === "note" ? (countMap.get(row.id) ?? 0) : 0,
    share_visibility: shareMap.get(row.id) ?? null,
    category_name: row.category_id ? (categoryNameMap.get(row.category_id) ?? null) : null,
  }));
}
