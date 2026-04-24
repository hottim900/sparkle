import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./db/schema.js";
import { setupFTS, setupVaultFTS } from "./db/fts.js";

export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      color TEXT DEFAULT NULL,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );
    CREATE INDEX idx_categories_sort_order ON categories(sort_order);

    CREATE TABLE items_active (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'note',
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'fleeting',
      priority TEXT,
      due TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      origin TEXT DEFAULT '',
      source TEXT DEFAULT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      linked_note_id TEXT DEFAULT NULL,
      category_id TEXT DEFAULT NULL,
      viewed_at TEXT DEFAULT NULL,
      is_private INTEGER DEFAULT 0,
      paused INTEGER NOT NULL DEFAULT 0,
      paused_at TEXT DEFAULT NULL,
      paused_context TEXT DEFAULT NULL,
      created TEXT NOT NULL,
      modified TEXT NOT NULL,
      FOREIGN KEY (linked_note_id) REFERENCES items_active(id) ON DELETE SET NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_items_active_type_status ON items_active(type, status);
    CREATE INDEX idx_items_active_category_id ON items_active(category_id);
    CREATE INDEX idx_items_active_modified ON items_active(modified);
    CREATE INDEX idx_items_active_viewed_at ON items_active(viewed_at);

    CREATE TABLE items_vault (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category_id TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      aliases TEXT NOT NULL DEFAULT '[]',
      source TEXT,
      origin TEXT,
      export_path TEXT,
      exported_at TEXT NOT NULL,
      created TEXT NOT NULL,
      is_private INTEGER NOT NULL DEFAULT 0,
      content_snippet TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_items_vault_category_id ON items_vault(category_id);
    CREATE INDEX idx_items_vault_exported_at ON items_vault(exported_at);

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT INTO settings (key, value) VALUES
      ('obsidian_enabled', 'false'),
      ('obsidian_vault_path', ''),
      ('obsidian_inbox_folder', '0_Inbox'),
      ('obsidian_export_mode', 'overwrite'),
      ('recent_days', '7'),
      ('stale_days', '14');

    CREATE TABLE share_tokens (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      visibility TEXT NOT NULL DEFAULT 'unlisted',
      created TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items_active(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_share_tokens_token ON share_tokens(token);
    CREATE INDEX idx_share_tokens_item_id ON share_tokens(item_id);

    CREATE TABLE vault_files (
      path TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      frontmatter TEXT,
      content TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      sparkle_id TEXT DEFAULT NULL
    );
    CREATE UNIQUE INDEX idx_vault_files_sparkle_id ON vault_files(sparkle_id) WHERE sparkle_id IS NOT NULL;
  `);

  setupFTS(sqlite);
  setupVaultFTS(sqlite);

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
