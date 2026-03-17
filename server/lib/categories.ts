import { eq, asc, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { categories } from "../db/schema.js";
import type { CreateCategoryInput, UpdateCategoryInput } from "../schemas/categories.js";
import type * as schema from "../db/schema.js";

type DB = BetterSQLite3Database<typeof schema>;

export function createCategory(db: DB, input: CreateCategoryInput) {
  const now = new Date().toISOString();
  const id = uuidv4();

  return db.transaction((tx) => {
    // Get max sort_order inside transaction to prevent race conditions
    const maxResult = tx
      .select({ maxOrder: sql<number | null>`MAX(${categories.sort_order})` })
      .from(categories)
      .get();
    const sort_order = maxResult?.maxOrder != null ? maxResult.maxOrder + 1 : 0;

    tx.insert(categories)
      .values({
        id,
        name: input.name,
        color: input.color ?? null,
        sort_order,
        created: now,
        modified: now,
      })
      .run();

    return tx.select().from(categories).where(eq(categories.id, id)).get()!;
  });
}

export function getCategory(db: DB, id: string) {
  return db.select().from(categories).where(eq(categories.id, id)).get() ?? null;
}

export function listCategories(db: DB) {
  return db.select().from(categories).orderBy(asc(categories.sort_order)).all();
}

export function updateCategory(db: DB, id: string, input: UpdateCategoryInput) {
  const existing = getCategory(db, id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { modified: now };

  if (input.name !== undefined) updates.name = input.name;
  if (input.color !== undefined) updates.color = input.color;
  if (input.sort_order !== undefined) updates.sort_order = input.sort_order;

  db.update(categories).set(updates).where(eq(categories.id, id)).run();

  return getCategory(db, id);
}

export function deleteCategory(db: DB, id: string): boolean {
  const result = db.delete(categories).where(eq(categories.id, id)).run();
  return result.changes > 0;
}

export function reorderCategories(db: DB, items: { id: string; sort_order: number }[]): void {
  const now = new Date().toISOString();
  db.transaction((tx) => {
    for (const item of items) {
      tx.update(categories)
        .set({ sort_order: item.sort_order, modified: now })
        .where(eq(categories.id, item.id))
        .run();
    }
  });
}
