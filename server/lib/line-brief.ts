import type Database from "better-sqlite3";
import { toLocalDateStr } from "./stats.js";
import { pushLine } from "./line-format.js";
import { logger } from "./logger.js";

// --- Types ---

interface OverdueTodo {
  id: string;
  title: string;
  due: string;
  priority: string | null;
}

interface StaleFleeting {
  id: string;
  title: string;
  days_stale: number;
}

export interface BriefData {
  date: string;
  overdue_todos: OverdueTodo[];
  stale_fleetings: StaleFleeting[];
  notes_created_count: number;
  notes_modified_count: number;
  todos_due_count: number;
  todos_done_count: number;
  total_activity: number;
}

export interface BriefResult {
  sent: boolean;
  skipped?: boolean;
  reason?: string;
  message?: string;
}

// --- Query ---

/** Get UTC ISO string for the start of a local day. */
function getLocalDayBoundary(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toISOString();
}

export function queryBriefData(sqlite: Database.Database, dateStr: string): BriefData {
  const [y, m, d] = dateStr.split("-").map(Number);
  const nextDate = toLocalDateStr(new Date(y!, m! - 1, d! + 1));

  const rangeStart = getLocalDayBoundary(dateStr);
  const rangeEnd = getLocalDayBoundary(nextDate);

  // Overdue todos (due before today, still active)
  const overdue_todos = sqlite
    .prepare(
      `SELECT id, title, due, priority
       FROM items
       WHERE type = 'todo'
         AND status NOT IN ('done', 'exported', 'archived')
         AND due IS NOT NULL
         AND due < ?
         AND is_private = 0
       ORDER BY due ASC
       LIMIT 10`,
    )
    .all(dateStr) as OverdueTodo[];

  // Stale fleeting notes (>7 days without modification)
  const stale_fleetings = sqlite
    .prepare(
      `SELECT id, title,
        CAST(julianday(?) - julianday(modified) AS INTEGER) AS days_stale
       FROM items
       WHERE type = 'note'
         AND status = 'fleeting'
         AND modified < datetime(?, '-7 days')
         AND is_private = 0
       ORDER BY modified ASC
       LIMIT 5`,
    )
    .all(rangeStart, rangeStart) as StaleFleeting[];

  // Notes created today
  const notesCreatedRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM items
       WHERE type = 'note'
         AND created >= ? AND created < ?
         AND status != 'archived'
         AND is_private = 0`,
    )
    .get(rangeStart, rangeEnd) as { cnt: number };

  // Notes modified today (exclude same-day created)
  const notesModifiedRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM items
       WHERE type = 'note'
         AND modified >= ? AND modified < ?
         AND created < ?
         AND status != 'archived'
         AND is_private = 0`,
    )
    .get(rangeStart, rangeEnd, rangeStart) as { cnt: number };

  // Todos due today
  const todosDueRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM items
       WHERE type = 'todo'
         AND due = ?
         AND status NOT IN ('done', 'exported', 'archived')
         AND is_private = 0`,
    )
    .get(dateStr) as { cnt: number };

  // Todos done today (modified today + status = done)
  const todosDoneRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM items
       WHERE type = 'todo'
         AND status = 'done'
         AND modified >= ? AND modified < ?
         AND is_private = 0`,
    )
    .get(rangeStart, rangeEnd) as { cnt: number };

  const notes_created_count = notesCreatedRow.cnt;
  const notes_modified_count = notesModifiedRow.cnt;
  const todos_due_count = todosDueRow.cnt;
  const todos_done_count = todosDoneRow.cnt;

  const total_activity =
    notes_created_count + notes_modified_count + todos_due_count + todos_done_count;

  return {
    date: dateStr,
    overdue_todos,
    stale_fleetings,
    notes_created_count,
    notes_modified_count,
    todos_due_count,
    todos_done_count,
    total_activity,
  };
}

// --- Smart push decision ---

export function shouldPush(data: BriefData): { push: boolean; reason?: string } {
  if (data.overdue_todos.length > 0) {
    return { push: true, reason: "overdue_todos" };
  }
  if (data.stale_fleetings.length > 0) {
    return { push: true, reason: "stale_fleetings" };
  }
  if (data.total_activity >= 3) {
    return { push: true, reason: "activity_summary" };
  }
  return { push: false };
}

// --- Format ---

function dayOfWeekChinese(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  const names = ["日", "一", "二", "三", "四", "五", "六"];
  return names[date.getDay()]!;
}

function formatMonth(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}月${d}日`;
}

export function formatBriefMessage(data: BriefData): string {
  const dateLabel = formatMonth(data.date);
  const dow = dayOfWeekChinese(data.date);
  const lines: string[] = [];

  lines.push(`📊 Sparkle 每日簡報 — ${dateLabel}（${dow}）`);
  lines.push("");

  // Notes summary
  if (data.notes_created_count > 0 || data.notes_modified_count > 0) {
    const parts: string[] = [];
    if (data.notes_created_count > 0) parts.push(`捕捉 ${data.notes_created_count} 個新想法`);
    if (data.notes_modified_count > 0) parts.push(`推進 ${data.notes_modified_count} 篇筆記`);
    lines.push(`📝 筆記：${parts.join("，")}`);
  }

  // Todos summary
  const todoParts: string[] = [];
  todoParts.push(`${data.todos_done_count} 完成`);
  todoParts.push(`${data.todos_due_count} 待處理`);
  lines.push(`✅ 待辦：${todoParts.join(" / ")}`);

  // Overdue
  if (data.overdue_todos.length > 0) {
    lines.push(`⚠️ 逾期：${data.overdue_todos.length} 項`);
    for (const todo of data.overdue_todos.slice(0, 3)) {
      const priority = todo.priority === "high" ? " ⚡" : "";
      lines.push(`   • ${todo.title}（${todo.due}）${priority}`);
    }
    if (data.overdue_todos.length > 3) {
      lines.push(`   …還有 ${data.overdue_todos.length - 3} 項`);
    }
  } else {
    lines.push("⚠️ 逾期：無");
  }

  // Stale fleetings
  if (data.stale_fleetings.length > 0) {
    lines.push("");
    lines.push("💡 這些閃念放了一陣子，值得發展嗎？");
    for (const note of data.stale_fleetings.slice(0, 3)) {
      lines.push(`   • 「${note.title}」（${note.days_stale} 天前）`);
    }
  }

  return lines.join("\n");
}

// --- Public API ---

export async function generateAndPushBrief(
  sqlite: Database.Database,
  dateStr?: string,
): Promise<BriefResult> {
  const targetDate = dateStr || toLocalDateStr(new Date());

  // Check LINE Bot config
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    return { sent: false, skipped: true, reason: "LINE_CHANNEL_ACCESS_TOKEN not set" };
  }

  const userIds = process.env.LINE_ALLOWED_USER_IDS?.split(",").filter(Boolean) ?? [];
  if (userIds.length === 0) {
    return { sent: false, skipped: true, reason: "LINE_ALLOWED_USER_IDS not set" };
  }

  // Query data
  const data = queryBriefData(sqlite, targetDate);

  // Smart push decision
  const decision = shouldPush(data);
  if (!decision.push) {
    return { sent: false, skipped: true, reason: "No actionable items (quiet day)" };
  }

  // Format message
  const message = formatBriefMessage(data);

  // Push to all allowed users concurrently
  const results = await Promise.all(userIds.map((userId) => pushLine(token, userId, message)));
  const anySuccess = results.some(Boolean);

  if (!anySuccess) {
    return { sent: false, reason: "All push attempts failed" };
  }

  logger.info(
    { date: targetDate, reason: decision.reason, userCount: userIds.length },
    "LINE daily brief sent",
  );

  return { sent: true, message };
}
