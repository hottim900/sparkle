import type { CommandHandler } from "./types.js";
import type { LineCommand } from "../line.js";
import { HELP_TEXT } from "./shared.js";
import { listItems, searchItems } from "../items.js";
import { getStats, getFocusItems } from "../stats.js";
import { setSession } from "../line-session.js";
import { formatNumberedList, formatStats } from "../line-format.js";
import { logger } from "../logger.js";

const handleHelp: CommandHandler = async () => HELP_TEXT;

const handleFind: CommandHandler = async ({ userId, command, sqlite, db }) => {
  const cmd = command as Extract<LineCommand, { type: "find" }>;
  try {
    const results = searchItems(sqlite, db, cmd.keyword, 5, false);
    if (results.length === 0) return `🔍 找不到「${cmd.keyword}」相關的項目`;
    setSession(
      userId,
      results.map((r) => r.id),
    );
    return formatNumberedList(`🔍 搜尋「${cmd.keyword}」`, results, results.length);
  } catch (err) {
    logger.error({ err, userId }, "LINE webhook search failed");
    return "❌ 搜尋失敗，請稍後再試";
  }
};

const handleStats: CommandHandler = async ({ sqlite }) => {
  const stats = getStats(sqlite);
  return formatStats(stats);
};

const handleToday: CommandHandler = async ({ userId, sqlite }) => {
  const focusItems = getFocusItems(sqlite);
  if (focusItems.length === 0) return "📅 今天沒有待處理的項目！";
  setSession(
    userId,
    focusItems.map((r) => r.id),
  );
  return formatNumberedList("📅 今日焦點", focusItems, focusItems.length);
};

function makeListHandler(
  emoji: string,
  label: string,
  emptyMsg: string,
  filters: Parameters<typeof listItems>[1],
): CommandHandler {
  return async ({ userId, db }) => {
    const { items, total } = listItems(db, filters, false);
    if (total === 0) return `${emoji} ${emptyMsg}`;
    setSession(
      userId,
      items.map((r) => r.id),
    );
    return formatNumberedList(`${emoji} ${label}`, items, total);
  };
}

const handleFleeting = makeListHandler("✨", "閃念筆記", "沒有閃念筆記", {
  status: "fleeting",
  sort: "created",
  order: "desc",
  limit: 5,
});

const handleActive = makeListHandler("🔵", "進行中", "沒有進行中的待辦", {
  status: "active",
  type: "todo",
  sort: "due",
  order: "asc",
  limit: 5,
});

const handleDeveloping = makeListHandler("📝", "發展中", "沒有發展中的筆記", {
  status: "developing",
  sort: "created",
  order: "desc",
  limit: 5,
});

const handlePermanent = makeListHandler("💎", "永久筆記", "沒有永久筆記", {
  status: "permanent",
  sort: "created",
  order: "desc",
  limit: 5,
});

const handleNotes = makeListHandler("📝", "筆記", "沒有筆記", {
  type: "note",
  excludeStatus: ["archived"],
  sort: "created",
  order: "desc",
  limit: 5,
});

const handleTodos = makeListHandler("☑️", "待辦事項", "沒有待辦事項", {
  type: "todo",
  excludeStatus: ["archived"],
  sort: "created",
  order: "desc",
  limit: 5,
});

const handleScratch = makeListHandler("📌", "暫存", "沒有暫存項目", {
  type: "scratch",
  status: "draft",
  sort: "modified",
  order: "desc",
  limit: 5,
});

const handleList: CommandHandler = async ({ userId, command, db }) => {
  const cmd = command as Extract<LineCommand, { type: "list" }>;
  const { items, total } = listItems(db, { tag: cmd.tag, limit: 5 }, false);
  if (total === 0) return `🏷️ 找不到標籤「${cmd.tag}」的項目`;
  setSession(
    userId,
    items.map((r) => r.id),
  );
  return formatNumberedList(`🏷️ 標籤「${cmd.tag}」`, items, total);
};

export const queryHandlers: Record<string, CommandHandler> = {
  help: handleHelp,
  find: handleFind,
  stats: handleStats,
  today: handleToday,
  fleeting: handleFleeting,
  active: handleActive,
  developing: handleDeveloping,
  permanent: handlePermanent,
  notes: handleNotes,
  todos: handleTodos,
  scratch: handleScratch,
  list: handleList,
};
