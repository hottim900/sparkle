import { randomBytes } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import type Database from "better-sqlite3";

export interface ShareTokenRow {
  id: string;
  item_id: string;
  token: string;
  visibility: "unlisted" | "public";
  created: string;
}

export interface ShareWithItem extends ShareTokenRow {
  item_title: string;
  item_content: string;
  item_type: string;
  item_status: string;
  item_tags: string;
  item_aliases: string;
  item_created: string;
  item_modified: string;
}

export interface ShareListItem extends ShareTokenRow {
  item_title: string;
}

function generateToken(): string {
  return randomBytes(9).toString("base64url");
}

export function createShareToken(
  sqlite: Database.Database,
  itemId: string,
  visibility: "unlisted" | "public" = "unlisted",
): ShareTokenRow | null {
  // Verify item exists and is a note
  const item = sqlite
    .prepare("SELECT id, type FROM items WHERE id = ?")
    .get(itemId) as { id: string; type: string } | undefined;

  if (!item) return null;
  if (item.type !== "note") return null;

  const id = uuidv4();
  const token = generateToken();
  const now = new Date().toISOString();

  sqlite
    .prepare(
      "INSERT INTO share_tokens (id, item_id, token, visibility, created) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, itemId, token, visibility, now);

  return sqlite
    .prepare("SELECT * FROM share_tokens WHERE id = ?")
    .get(id) as ShareTokenRow;
}

export function getShareByToken(
  sqlite: Database.Database,
  token: string,
): ShareWithItem | null {
  const row = sqlite
    .prepare(
      `SELECT
        s.id, s.item_id, s.token, s.visibility, s.created,
        i.title AS item_title,
        i.content AS item_content,
        i.type AS item_type,
        i.status AS item_status,
        i.tags AS item_tags,
        i.aliases AS item_aliases,
        i.created AS item_created,
        i.modified AS item_modified
      FROM share_tokens s
      JOIN items i ON i.id = s.item_id
      WHERE s.token = ?`,
    )
    .get(token) as ShareWithItem | undefined;

  return row ?? null;
}

export function listShares(sqlite: Database.Database): ShareListItem[] {
  return sqlite
    .prepare(
      `SELECT
        s.id, s.item_id, s.token, s.visibility, s.created,
        i.title AS item_title
      FROM share_tokens s
      JOIN items i ON i.id = s.item_id
      ORDER BY s.created DESC`,
    )
    .all() as ShareListItem[];
}

export function listPublicShares(sqlite: Database.Database): ShareListItem[] {
  return sqlite
    .prepare(
      `SELECT
        s.id, s.item_id, s.token, s.visibility, s.created,
        i.title AS item_title
      FROM share_tokens s
      JOIN items i ON i.id = s.item_id
      WHERE s.visibility = 'public'
      ORDER BY s.created DESC`,
    )
    .all() as ShareListItem[];
}

export function revokeShare(
  sqlite: Database.Database,
  shareId: string,
): boolean {
  const result = sqlite
    .prepare("DELETE FROM share_tokens WHERE id = ?")
    .run(shareId);
  return result.changes > 0;
}

export function getSharesByItemId(
  sqlite: Database.Database,
  itemId: string,
): ShareTokenRow[] {
  return sqlite
    .prepare(
      "SELECT * FROM share_tokens WHERE item_id = ? ORDER BY created DESC",
    )
    .all(itemId) as ShareTokenRow[];
}
