import type Database from "better-sqlite3";

/**
 * Format a Date as local YYYY-MM-DD.
 */
function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Get the start of the current ISO week (Monday 00:00:00 local) as a UTC ISO string.
 * Used for comparing against created/modified which are stored in UTC.
 */
function getISOWeekStart(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  return monday.toISOString();
}

/**
 * Get the start of the current calendar month (1st 00:00:00 local) as a UTC ISO string.
 * Used for comparing against created/modified which are stored in UTC.
 */
function getMonthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

/**
 * Get today's date as local YYYY-MM-DD (for due comparisons).
 * due is stored as YYYY-MM-DD without timezone, implicitly local.
 */
function getTodayDate(): string {
  return toLocalDateStr(new Date());
}

export interface Stats {
  // Zettelkasten
  fleeting_count: number;
  developing_count: number;
  permanent_count: number;
  exported_this_week: number;
  exported_this_month: number;
  // GTD
  active_count: number;
  done_this_week: number;
  done_this_month: number;
  // Scratch
  scratch_count: number;
  // Shared
  created_this_week: number;
  created_this_month: number;
  overdue_count: number;
}

/**
 * Return aggregated statistics from the items table.
 */
export function getStats(sqlite: Database.Database): Stats {
  const weekStart = getISOWeekStart();
  const monthStart = getMonthStart();
  const today = getTodayDate();

  const row = sqlite
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN status = 'fleeting' THEN 1 ELSE 0 END), 0) AS fleeting_count,
        COALESCE(SUM(CASE WHEN status = 'developing' THEN 1 ELSE 0 END), 0) AS developing_count,
        COALESCE(SUM(CASE WHEN status = 'permanent' THEN 1 ELSE 0 END), 0) AS permanent_count,
        COALESCE(SUM(CASE WHEN status = 'exported' AND modified >= ? THEN 1 ELSE 0 END), 0) AS exported_this_week,
        COALESCE(SUM(CASE WHEN status = 'exported' AND modified >= ? THEN 1 ELSE 0 END), 0) AS exported_this_month,
        COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
        COALESCE(SUM(CASE WHEN status = 'done' AND modified >= ? THEN 1 ELSE 0 END), 0) AS done_this_week,
        COALESCE(SUM(CASE WHEN status = 'done' AND modified >= ? THEN 1 ELSE 0 END), 0) AS done_this_month,
        COALESCE(SUM(CASE WHEN status = 'draft' AND type = 'scratch' THEN 1 ELSE 0 END), 0) AS scratch_count,
        COALESCE(SUM(CASE WHEN created >= ? THEN 1 ELSE 0 END), 0) AS created_this_week,
        COALESCE(SUM(CASE WHEN created >= ? THEN 1 ELSE 0 END), 0) AS created_this_month,
        COALESCE(SUM(CASE WHEN due < ? AND type = 'todo' AND status NOT IN ('done', 'exported', 'archived') THEN 1 ELSE 0 END), 0) AS overdue_count
      FROM items
      WHERE is_private = 0`,
    )
    .get(weekStart, monthStart, weekStart, monthStart, weekStart, monthStart, today) as Stats;

  return row;
}

export interface DashboardItem {
  id: string;
  type: string;
  title: string;
  status: string;
  priority: string | null;
  due: string | null;
  tags: string;
  origin: string;
  category_id: string | null;
  category_name: string | null;
  created: string;
  modified: string;
  viewed_at: string | null;
}

export interface AttentionItem extends DashboardItem {
  attention_reason: "overdue" | "high_priority";
}

export interface StaleItem {
  id: string;
  title: string;
  category_name: string | null;
  modified: string;
  days_stale: number;
}

export function getStaleNotes(
  sqlite: Database.Database,
  days = 7,
  limit = 10,
): { items: StaleItem[]; total: number } {
  const items = sqlite
    .prepare(
      `SELECT i.id, i.title, c.name AS category_name, i.modified,
        CAST(julianday('now') - julianday(i.modified) AS INTEGER) AS days_stale
       FROM items i
       LEFT JOIN categories c ON i.category_id = c.id
       WHERE i.status = 'developing'
         AND i.modified < datetime('now', '-' || ? || ' days')
         AND i.is_private = 0
       ORDER BY i.modified ASC
       LIMIT ?`,
    )
    .all(days, limit) as StaleItem[];

  const countRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS count
       FROM items i
       WHERE i.status = 'developing'
         AND i.modified < datetime('now', '-' || ? || ' days')
         AND i.is_private = 0`,
    )
    .get(days) as { count: number };

  return { items, total: countRow.count };
}

export function getUnreviewedItems(
  sqlite: Database.Database,
  limit = 5,
  offset = 0,
): { items: DashboardItem[]; total: number } {
  const items = sqlite
    .prepare(
      `SELECT i.*, c.name AS category_name
       FROM items i
       LEFT JOIN categories c ON i.category_id = c.id
       WHERE i.viewed_at IS NULL
         AND i.status NOT IN ('archived', 'done')
         AND i.is_private = 0
       ORDER BY i.created DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as DashboardItem[];

  const countRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS count
       FROM items i
       WHERE i.viewed_at IS NULL
         AND i.status NOT IN ('archived', 'done')
         AND i.is_private = 0`,
    )
    .get() as { count: number };

  return { items, total: countRow.count };
}

export function getRecentItems(
  sqlite: Database.Database,
  days: number,
  limit = 5,
  offset = 0,
): { items: DashboardItem[]; total: number } {
  const items = sqlite
    .prepare(
      `SELECT i.*, c.name AS category_name
       FROM items i
       LEFT JOIN categories c ON i.category_id = c.id
       WHERE i.created >= datetime('now', '-' || ? || ' days')
         AND i.status != 'archived'
         AND i.is_private = 0
       ORDER BY i.created DESC
       LIMIT ? OFFSET ?`,
    )
    .all(days, limit, offset) as DashboardItem[];

  const countRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS count
       FROM items i
       WHERE i.created >= datetime('now', '-' || ? || ' days')
         AND i.status != 'archived'
         AND i.is_private = 0`,
    )
    .get(days) as { count: number };

  return { items, total: countRow.count };
}

export function getAttentionItems(
  sqlite: Database.Database,
  limit = 5,
): { items: AttentionItem[]; total: number } {
  const today = getTodayDate();

  const items = sqlite
    .prepare(
      `SELECT i.*, c.name AS category_name,
        CASE WHEN i.type = 'todo' AND i.due < :today THEN 'overdue' ELSE 'high_priority' END AS attention_reason
       FROM items i
       LEFT JOIN categories c ON i.category_id = c.id
       WHERE i.status NOT IN ('done', 'archived') AND i.type != 'scratch'
         AND ((i.type = 'todo' AND i.due < :today) OR i.priority = 'high')
         AND i.is_private = 0
       ORDER BY attention_reason ASC, i.due ASC, i.created DESC
       LIMIT :limit`,
    )
    .all({ today, limit }) as AttentionItem[];

  const countRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS count
       FROM items i
       WHERE i.status NOT IN ('done', 'archived') AND i.type != 'scratch'
         AND ((i.type = 'todo' AND i.due < :today) OR i.priority = 'high')
         AND i.is_private = 0`,
    )
    .get({ today }) as { count: number };

  return { items, total: countRow.count };
}

export interface CategoryDistribution {
  category_id: string | null;
  category_name: string;
  color: string | null;
  count: number;
}

export function getCategoryDistribution(sqlite: Database.Database): CategoryDistribution[] {
  return sqlite
    .prepare(
      `SELECT
        i.category_id,
        COALESCE(c.name, '未分類') AS category_name,
        c.color,
        COUNT(*) AS count
       FROM items i
       LEFT JOIN categories c ON i.category_id = c.id
       WHERE i.status NOT IN ('archived', 'done')
         AND i.is_private = 0
       GROUP BY i.category_id
       ORDER BY count DESC`,
    )
    .all() as CategoryDistribution[];
}

export interface FocusItem {
  id: string;
  type: string;
  title: string;
  content: string;
  status: string;
  priority: string | null;
  due: string | null;
  tags: string;
  origin: string;
  source: string | null;
  aliases: string;
  created: string;
  modified: string;
}

/**
 * Return up to 5 suggested items to work on today, ordered by priority:
 * 1. Overdue items (most days overdue first)
 * 2. Due today
 * 3. Due within 7 days (earliest due date first)
 * 4. High-priority active todos
 * 5. Oldest fleeting notes (remind to process)
 */
export function getFocusItems(sqlite: Database.Database): FocusItem[] {
  const today = getTodayDate();

  const rows = sqlite
    .prepare(
      `SELECT * FROM (
        SELECT items.*,
          CASE
            WHEN type = 'todo' AND due < :today THEN 1
            WHEN type = 'todo' AND due = :today THEN 2
            WHEN type = 'todo' AND due > :today AND due <= date(:today, '+7 days') THEN 3
            WHEN priority = 'high' AND status = 'active' THEN 4
            WHEN status = 'fleeting' THEN 5
            ELSE 6
          END AS focus_rank,
          CASE
            WHEN type = 'todo' AND due IS NOT NULL AND due <= date(:today, '+7 days') THEN due
            ELSE created
          END AS focus_sort
        FROM items
        WHERE status NOT IN ('done', 'exported', 'archived')
          AND type != 'scratch'
          AND is_private = 0
      ) ranked
      WHERE focus_rank < 6
      ORDER BY focus_rank ASC, focus_sort ASC
      LIMIT 5`,
    )
    .all({ today }) as (FocusItem & {
    focus_rank: number;
    focus_sort: string;
  })[];

  // Strip the computed columns before returning
  return rows.map(({ focus_rank: _, focus_sort: __, ...item }) => item);
}
