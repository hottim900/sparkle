import type { CommandHandler } from "./types.js";
import type { LineCommand } from "../line.js";
import { resolveSessionItem } from "./shared.js";
import { createItem } from "../items.js";
import { parseDate } from "../line-date.js";
import { logger } from "../logger.js";

const handleSave: CommandHandler = async ({ command, db }) => {
  const cmd = command as Extract<LineCommand, { type: "save" }>;
  if (!cmd.parsed.title) return null;
  try {
    const item = createItem(db, {
      title: cmd.parsed.title,
      content: cmd.parsed.content,
      type: cmd.parsed.type,
      priority: cmd.parsed.priority,
      origin: cmd.parsed.source,
    });
    if (cmd.parsed.is_private) {
      return "✅ 已記錄";
    }
    const typeLabel = item.type === "todo" ? "待辦" : item.type === "scratch" ? "暫存" : "閃念筆記";
    const priorityLabel = cmd.parsed.priority === "high" ? " [高優先]" : "";
    return `✅ 已存入（${typeLabel}${priorityLabel}）\n${item.title}`;
  } catch (err) {
    logger.error({ err }, "Failed to create item from LINE");
    return "❌ 儲存失敗，請稍後再試";
  }
};

const handleTrack: CommandHandler = async ({ userId, command, db }) => {
  const cmd = command as Extract<LineCommand, { type: "track" }>;
  const resolved = resolveSessionItem(db, userId, cmd.index);
  if (!resolved.ok) return resolved.error;
  if (resolved.item.type !== "note") return "❌ 此指令只適用於筆記";
  const noteTags: string[] = JSON.parse(resolved.item.tags || "[]");
  const trackInput: Record<string, unknown> = {
    title: `處理：${resolved.item.title}`,
    type: "todo",
    status: "active",
    origin: "LINE",
    tags: noteTags,
    linked_note_id: resolved.item.id,
  };
  if (cmd.dateInput) {
    const dateParsed = parseDate(cmd.dateInput);
    if (!dateParsed.success) return "❌ 無法辨識日期，請用 YYYY-MM-DD 或中文如『明天』『3天後』";
    if (!dateParsed.clear && dateParsed.date) {
      trackInput.due = dateParsed.date;
    }
  }
  const trackTodo = createItem(db, trackInput as Parameters<typeof createItem>[1]);
  let reply = `✅ 已建立追蹤待辦：${trackTodo.title}`;
  if (trackTodo.due) reply += `\n📅 ${trackTodo.due}`;
  return reply;
};

export const createHandlers: Record<string, CommandHandler> = {
  save: handleSave,
  track: handleTrack,
};
