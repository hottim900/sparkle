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
 * Used for comparing against created_at/updated_at which are stored in UTC.
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
 * Used for comparing against created_at/updated_at which are stored in UTC.
 */
function getMonthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

/**
 * Get today's date as local YYYY-MM-DD (for due_date comparisons).
 * due_date is stored as YYYY-MM-DD without timezone, implicitly local.
 */
function getTodayDate(): string {
  return toLocalDateStr(new Date());
}

export interface Stats {
  completed_this_week: number;
  completed_this_month: number;
  created_this_week: number;
  created_this_month: number;
  inbox_count: number;
  active_count: number;
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
        COALESCE(SUM(CASE WHEN status = 'done' AND updated_at >= ? THEN 1 ELSE 0 END), 0) AS completed_this_week,
        COALESCE(SUM(CASE WHEN status = 'done' AND updated_at >= ? THEN 1 ELSE 0 END), 0) AS completed_this_month,
        COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS created_this_week,
        COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS created_this_month,
        COALESCE(SUM(CASE WHEN status = 'inbox' THEN 1 ELSE 0 END), 0) AS inbox_count,
        COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active_count,
        COALESCE(SUM(CASE WHEN due_date < ? AND status NOT IN ('done', 'archived') THEN 1 ELSE 0 END), 0) AS overdue_count
      FROM items`,
    )
    .get(weekStart, monthStart, weekStart, monthStart, today) as Stats;

  return row;
}

export interface FocusItem {
  id: string;
  type: string;
  title: string;
  content: string;
  status: string;
  priority: string | null;
  due_date: string | null;
  tags: string;
  source: string;
  created_at: string;
  updated_at: string;
}

/**
 * Return up to 5 suggested items to work on today, ordered by priority:
 * 1. Overdue todos (most days overdue first)
 * 2. Due today
 * 3. Due within 7 days (earliest due date first)
 * 4. High-priority active items (oldest first)
 * 5. Oldest inbox items (sitting too long)
 */
export function getFocusItems(sqlite: Database.Database): FocusItem[] {
  const today = getTodayDate();

  const rows = sqlite
    .prepare(
      `SELECT * FROM (
        SELECT items.*,
          CASE
            WHEN due_date < :today THEN 1
            WHEN due_date = :today THEN 2
            WHEN due_date > :today AND due_date <= date(:today, '+7 days') THEN 3
            WHEN priority = 'high' AND status = 'active' THEN 4
            WHEN status = 'inbox' THEN 5
            ELSE 6
          END AS focus_rank,
          CASE
            WHEN due_date IS NOT NULL AND due_date <= date(:today, '+7 days') THEN due_date
            ELSE created_at
          END AS focus_sort
        FROM items
        WHERE status NOT IN ('done', 'archived')
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
  return rows.map(({ focus_rank, focus_sort, ...item }) => item);
}
