import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const items = sqliteTable(
  "items",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["note", "todo", "scratch"] })
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
        "draft",
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
    category_id: text("category_id"),
    viewed_at: text("viewed_at"),
    is_private: integer("is_private").default(0),
    created: text("created").notNull(),
    modified: text("modified").notNull(),
  },
  (table) => [
    index("idx_items_status").on(table.status),
    index("idx_items_type").on(table.type),
    index("idx_items_created").on(table.created),
    index("idx_items_category_id").on(table.category_id),
    index("idx_items_viewed_at").on(table.viewed_at),
    index("idx_items_status_modified").on(table.status, table.modified),
    index("idx_items_private_status").on(table.is_private, table.status),
    index("idx_items_private_status_modified").on(table.is_private, table.status, table.modified),
  ],
);

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Setting = typeof settings.$inferSelect;

export const shareTokens = sqliteTable(
  "share_tokens",
  {
    id: text("id").primaryKey(),
    item_id: text("item_id").notNull(),
    token: text("token").notNull().unique(),
    visibility: text("visibility", { enum: ["unlisted", "public"] })
      .notNull()
      .default("unlisted"),
    created: text("created").notNull(),
  },
  (table) => [
    index("idx_share_tokens_token").on(table.token),
    index("idx_share_tokens_item_id").on(table.item_id),
  ],
);

export type ShareToken = typeof shareTokens.$inferSelect;
export type NewShareToken = typeof shareTokens.$inferInsert;

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  sort_order: integer("sort_order").notNull().default(0),
  color: text("color"),
  created: text("created").notNull(),
  modified: text("modified").notNull(),
});

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
