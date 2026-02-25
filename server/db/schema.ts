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
      enum: [
        "fleeting",
        "developing",
        "permanent",
        "exported",
        "active",
        "done",
        "archived",
      ],
    })
      .notNull()
      .default("fleeting"),
    priority: text("priority", { enum: ["low", "medium", "high"] }),
    due: text("due"),
    tags: text("tags").notNull().default("[]"),
    origin: text("origin").default(""),
    source: text("source"),
    aliases: text("aliases").notNull().default("[]"),
    linked_note_id: text("linked_note_id"),
    created: text("created").notNull(),
    modified: text("modified").notNull(),
  },
  (table) => [
    index("idx_items_status").on(table.status),
    index("idx_items_type").on(table.type),
    index("idx_items_created").on(table.created),
  ],
);

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Setting = typeof settings.$inferSelect;
