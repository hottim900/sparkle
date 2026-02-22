import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema.js";
import { setupFTS } from "./fts.js";

const DB_PATH = process.env.DATABASE_URL || "./data/todo.db";

function createDb() {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  // Create tables via raw SQL (Drizzle push equivalent)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'note',
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'inbox',
      priority TEXT,
      due_date TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      source TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
    CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
    CREATE INDEX IF NOT EXISTS idx_items_created_at ON items(created_at DESC);
  `);

  setupFTS(sqlite);

  return { db, sqlite };
}

// Cache on globalThis to avoid multiple connections in dev (tsx watch)
declare global {
  // eslint-disable-next-line no-var
  var __db: ReturnType<typeof createDb> | undefined;
}

function getDb() {
  if (!globalThis.__db) {
    globalThis.__db = createDb();
  }
  return globalThis.__db;
}

export const { db, sqlite } = getDb();
export { DB_PATH };
