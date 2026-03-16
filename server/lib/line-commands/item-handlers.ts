import type { CommandHandler } from "./types.js";
import type { LineCommand } from "../line.js";
import { resolveSessionItem } from "./shared.js";
import { updateItem, deleteItem } from "../items.js";
import { exportToObsidian } from "../export.js";
import { getObsidianSettings } from "../settings.js";
import { parseDate } from "../line-date.js";
import { formatDetail, STATUS_LABELS } from "../line-format.js";

// Each handler is registered by command.type in the dispatcher, so the Extract cast is always safe.

const handleDetail: CommandHandler = async ({ userId, command, db }) => {
  const cmd = command as Extract<LineCommand, { type: "detail" }>;
  const resolved = resolveSessionItem(db, userId, cmd.index);
  if (!resolved.ok) return resolved.error;
  return formatDetail(resolved.item);
};

const handleDue: CommandHandler = async ({ userId, command, db }) => {
  const cmd = command as Extract<LineCommand, { type: "due" }>;
  const resolved = resolveSessionItem(db, userId, cmd.index);
  if (!resolved.ok) return resolved.error;
  if (resolved.item.type !== "todo") return "❌ 到期日只適用於待辦";
  const dateParsed = parseDate(cmd.dateInput);
  if (!dateParsed.success) return "❌ 無法辨識日期，請用 YYYY-MM-DD 或中文如『明天』『3天後』";
  const dueDate = dateParsed.clear ? null : dateParsed.date;
  updateItem(db, resolved.itemId, { due: dueDate });
  return dateParsed.clear
    ? `✅ 已清除「${resolved.item.title}」的到期日`
    : `✅ 已設定「${resolved.item.title}」到期日為 ${dueDate}`;
};

const handleTag: CommandHandler = async ({ userId, command, db }) => {
  const cmd = command as Extract<LineCommand, { type: "tag" }>;
  const resolved = resolveSessionItem(db, userId, cmd.index);
  if (!resolved.ok) return resolved.error;
  const existingTags: string[] = JSON.parse(resolved.item.tags || "[]");
  const newTags = [...new Set([...existingTags, ...cmd.tags])].slice(0, 20);
  updateItem(db, resolved.itemId, { tags: newTags });
  return `✅ 已為「${resolved.item.title}」加上標籤：${cmd.tags.join("、")}`;
};

const handleDone: CommandHandler = async ({ userId, command, db }) => {
  const cmd = command as Extract<LineCommand, { type: "done" }>;
  const resolved = resolveSessionItem(db, userId, cmd.index);
  if (!resolved.ok) return resolved.error;
  if (resolved.item.type !== "todo") return "❌ 此指令只適用於待辦";
  updateItem(db, resolved.itemId, { status: "done" });
  return `✅ 已將「${resolved.item.title}」標記為已完成`;
};

const handleDevelop: CommandHandler = async ({ userId, command, db }) => {
  const cmd = command as Extract<LineCommand, { type: "develop" }>;
  const resolved = resolveSessionItem(db, userId, cmd.index);
  if (!resolved.ok) return resolved.error;
  if (resolved.item.type !== "note") return "❌ 此指令只適用於筆記";
  if (resolved.item.status === "developing") return `「${resolved.item.title}」已經是發展中狀態`;
  if (resolved.item.status !== "fleeting") {
    return `❌ 目前狀態為「${STATUS_LABELS[resolved.item.status] ?? resolved.item.status}」，無法執行此操作`;
  }
  updateItem(db, resolved.itemId, { status: "developing" });
  return `✅ 已將「${resolved.item.title}」推進為發展中`;
};

const handleMature: CommandHandler = async ({ userId, command, db }) => {
  const cmd = command as Extract<LineCommand, { type: "mature" }>;
  const resolved = resolveSessionItem(db, userId, cmd.index);
  if (!resolved.ok) return resolved.error;
  if (resolved.item.type !== "note") return "❌ 此指令只適用於筆記";
  if (resolved.item.status === "permanent") return `「${resolved.item.title}」已經是永久筆記`;
  if (resolved.item.status !== "developing") {
    return `❌ 目前狀態為「${STATUS_LABELS[resolved.item.status] ?? resolved.item.status}」，無法執行此操作`;
  }
  updateItem(db, resolved.itemId, { status: "permanent" });
  return `✅ 已將「${resolved.item.title}」提升為永久筆記`;
};

const handleExport: CommandHandler = async ({ userId, command, db, sqlite }) => {
  const cmd = command as Extract<LineCommand, { type: "export" }>;
  const resolved = resolveSessionItem(db, userId, cmd.index);
  if (!resolved.ok) return resolved.error;
  if (resolved.item.type !== "note") return "❌ 此指令只適用於筆記";
  if (resolved.item.status !== "permanent") {
    const label = STATUS_LABELS[resolved.item.status] ?? resolved.item.status;
    return `❌ 只有永久筆記可以匯出，目前狀態：${label}`;
  }
  const obsidian = getObsidianSettings(sqlite);
  if (!obsidian.obsidian_enabled || !obsidian.obsidian_vault_path) {
    return "❌ Obsidian 匯出未設定，請至設定頁面啟用";
  }
  try {
    const result = exportToObsidian(resolved.item, {
      vaultPath: obsidian.obsidian_vault_path,
      inboxFolder: obsidian.obsidian_inbox_folder,
      exportMode: obsidian.obsidian_export_mode,
    });
    updateItem(db, resolved.itemId, { status: "exported" });
    return `✅ 已匯出到 Obsidian: ${result.path}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `❌ 匯出失敗：${msg}`;
  }
};

const handleArchive: CommandHandler = async ({ userId, command, db }) => {
  const cmd = command as Extract<LineCommand, { type: "archive" }>;
  const resolved = resolveSessionItem(db, userId, cmd.index);
  if (!resolved.ok) return resolved.error;
  updateItem(db, resolved.itemId, { status: "archived" });
  return `✅ 已封存「${resolved.item.title}」`;
};

const handlePriority: CommandHandler = async ({ userId, command, db }) => {
  const cmd = command as Extract<LineCommand, { type: "priority" }>;
  const resolved = resolveSessionItem(db, userId, cmd.index);
  if (!resolved.ok) return resolved.error;
  updateItem(db, resolved.itemId, { priority: cmd.priority });
  return cmd.priority === null
    ? `✅ 已清除「${resolved.item.title}」的優先度`
    : `✅ 已將「${resolved.item.title}」優先度設為 ${cmd.priority}`;
};

const handleUntag: CommandHandler = async ({ userId, command, db }) => {
  const cmd = command as Extract<LineCommand, { type: "untag" }>;
  const resolved = resolveSessionItem(db, userId, cmd.index);
  if (!resolved.ok) return resolved.error;
  const currentTags: string[] = JSON.parse(resolved.item.tags || "[]");
  const remaining = currentTags.filter((t) => !cmd.tags.includes(t));
  updateItem(db, resolved.itemId, { tags: remaining });
  return `✅ 已從「${resolved.item.title}」移除標籤：${cmd.tags.join("、")}`;
};

const handleDelete: CommandHandler = async ({ userId, command, db }) => {
  const cmd = command as Extract<LineCommand, { type: "delete" }>;
  const resolved = resolveSessionItem(db, userId, cmd.index);
  if (!resolved.ok) return resolved.error;
  deleteItem(db, resolved.itemId);
  return `🗑️ 已刪除「${resolved.item.title}」`;
};

const handleUpgrade: CommandHandler = async ({ userId, command, db }) => {
  const cmd = command as Extract<LineCommand, { type: "upgrade" }>;
  const resolved = resolveSessionItem(db, userId, cmd.index);
  if (!resolved.ok) return resolved.error;
  if (resolved.item.type !== "scratch") return "❌ 此指令只適用於暫存項目";
  updateItem(db, resolved.itemId, { type: "note" });
  return `✅ 已將「${resolved.item.title}」升級為閃念筆記`;
};

export const itemHandlers: Record<string, CommandHandler> = {
  detail: handleDetail,
  due: handleDue,
  tag: handleTag,
  done: handleDone,
  develop: handleDevelop,
  mature: handleMature,
  export: handleExport,
  archive: handleArchive,
  priority: handlePriority,
  untag: handleUntag,
  delete: handleDelete,
  upgrade: handleUpgrade,
};
