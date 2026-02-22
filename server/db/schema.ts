import { sqliteTable, text, index } from "drizzle-orm/sqlite-core";

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["note", "todo"] })
      .notNull()
      .default("note"),
    title: text("title").notNull(),
    content: text("content").default(""),
    status: text("status", {
      enum: ["inbox", "active", "done", "archived"],
    })
      .notNull()
      .default("inbox"),
    priority: text("priority", { enum: ["low", "medium", "high"] }),
    due_date: text("due_date"),
    tags: text("tags").notNull().default("[]"),
    source: text("source").default(""),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_items_status").on(table.status),
    index("idx_items_type").on(table.type),
    index("idx_items_created_at").on(table.created_at),
  ],
);

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
