import { randomUUID } from "node:crypto";
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

// ---------------------------------------------------------------------------
// Row fixture helpers — prefer over hand-rolled per-file inserts.
// Shared to keep schema defaults (status enum, JSON array columns, paused
// semantics, etc.) in one place so column-shape changes touch one file.
// ---------------------------------------------------------------------------

export interface ActiveRowOverrides {
  id?: string;
  type?: "note" | "todo" | "scratch";
  title?: string;
  content?: string;
  status?: string;
  priority?: "low" | "medium" | "high" | null;
  due?: string | null;
  tags?: string[];
  aliases?: string[];
  source?: string | null;
  origin?: string;
  category_id?: string | null;
  linked_note_id?: string | null;
  viewed_at?: string | null;
  is_private?: 0 | 1;
  paused?: 0 | 1;
  paused_at?: string | null;
  paused_context?: string | null;
  created?: string;
  modified?: string;
}

function defaultActiveStatus(type: "note" | "todo" | "scratch"): string {
  return type === "todo" ? "active" : type === "scratch" ? "draft" : "fleeting";
}

export function insertActiveRow(
  sqlite: Database.Database,
  overrides: ActiveRowOverrides = {},
): string {
  const id = overrides.id ?? randomUUID();
  const now = new Date().toISOString();
  const type = overrides.type ?? "note";
  sqlite
    .prepare(
      `INSERT INTO items_active (
         id, type, title, content, status, priority, due,
         tags, aliases, origin, source, category_id, linked_note_id,
         viewed_at, is_private, paused, paused_at, paused_context,
         created, modified
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      type,
      overrides.title ?? "Test Active Row",
      overrides.content ?? "",
      overrides.status ?? defaultActiveStatus(type),
      overrides.priority ?? null,
      overrides.due ?? null,
      JSON.stringify(overrides.tags ?? []),
      JSON.stringify(overrides.aliases ?? []),
      overrides.origin ?? "",
      overrides.source ?? null,
      overrides.category_id ?? null,
      overrides.linked_note_id ?? null,
      overrides.viewed_at ?? null,
      overrides.is_private ?? 0,
      overrides.paused ?? 0,
      overrides.paused_at ?? null,
      overrides.paused_context ?? null,
      overrides.created ?? now,
      overrides.modified ?? now,
    );
  return id;
}

export interface VaultRowOverrides {
  id?: string;
  title?: string;
  category_id?: string | null;
  tags?: string[];
  aliases?: string[];
  source?: string | null;
  origin?: string | null;
  export_path?: string | null;
  exported_at?: string;
  created?: string;
  is_private?: 0 | 1;
  content_snippet?: string;
}

export function insertVaultRow(
  sqlite: Database.Database,
  overrides: VaultRowOverrides = {},
): string {
  const id = overrides.id ?? randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO items_vault (
         id, title, category_id, tags, aliases, source, origin,
         export_path, exported_at, created, is_private, content_snippet
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      overrides.title ?? "Test Vault Row",
      overrides.category_id ?? null,
      JSON.stringify(overrides.tags ?? []),
      JSON.stringify(overrides.aliases ?? []),
      overrides.source ?? null,
      overrides.origin ?? null,
      overrides.export_path ?? null,
      overrides.exported_at ?? now,
      overrides.created ?? now,
      overrides.is_private ?? 0,
      overrides.content_snippet ?? "",
    );
  return id;
}
