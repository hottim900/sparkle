import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";
import type * as schema from "../../db/schema.js";
import type { LineCommand } from "../line.js";
import type { ItemWithLinkedInfo } from "../item-enrichment.js";

export type DB = BetterSQLite3Database<typeof schema>;

export interface CommandContext {
  userId: string;
  command: LineCommand;
  db: DB;
  sqlite: Database.Database;
}

export type CommandHandler = (ctx: CommandContext) => Promise<string | null>;

export type SessionResult =
  | { ok: false; error: string }
  | { ok: true; itemId: string; item: ItemWithLinkedInfo };
