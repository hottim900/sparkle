import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const itemsActive = sqliteTable(
  "items_active",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["note", "todo", "scratch"] })
      .notNull()
      .default("note"),
    title: text("title").notNull(),
    content: text("content").default(""),
    status: text("status", {
      enum: ["fleeting", "developing", "permanent", "active", "done", "draft", "archived"],
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
    paused: integer("paused").notNull().default(0),
    paused_at: text("paused_at"),
    paused_context: text("paused_context"),
    created: text("created").notNull(),
    modified: text("modified").notNull(),
  },
  (table) => [
    index("idx_items_active_type_status").on(table.type, table.status),
    index("idx_items_active_category_id").on(table.category_id),
    index("idx_items_active_modified").on(table.modified),
    index("idx_items_active_viewed_at").on(table.viewed_at),
  ],
);

export type ItemActive = typeof itemsActive.$inferSelect;
export type NewItemActive = typeof itemsActive.$inferInsert;

export const itemsVault = sqliteTable(
  "items_vault",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    category_id: text("category_id"),
    tags: text("tags").notNull().default("[]"),
    aliases: text("aliases").notNull().default("[]"),
    source: text("source"),
    origin: text("origin"),
    export_path: text("export_path"),
    exported_at: text("exported_at").notNull(),
    created: text("created").notNull(),
    is_private: integer("is_private").notNull().default(0),
    content_snippet: text("content_snippet").notNull().default(""),
  },
  (table) => [
    index("idx_items_vault_category_id").on(table.category_id),
    index("idx_items_vault_exported_at").on(table.exported_at),
  ],
);

export type ItemVault = typeof itemsVault.$inferSelect;
export type NewItemVault = typeof itemsVault.$inferInsert;

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

// Note: vault_files uses TEXT PRIMARY KEY (path). SQLite maintains an implicit
// rowid which FTS5 external content table references via content_rowid=rowid.
// Do NOT add WITHOUT ROWID to this table.
export const vaultFiles = sqliteTable("vault_files", {
  path: text("path").primaryKey(),
  title: text("title").notNull(),
  frontmatter: text("frontmatter"),
  content: text("content").notNull(),
  mtime: integer("mtime").notNull(),
  content_hash: text("content_hash").notNull(),
  sparkle_id: text("sparkle_id"),
});

export type VaultFile = typeof vaultFiles.$inferSelect;
export type NewVaultFile = typeof vaultFiles.$inferInsert;
