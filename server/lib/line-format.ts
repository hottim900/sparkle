import type { Stats } from "./stats.js";
import { logger } from "./logger.js";

export interface ItemLike {
  id: string;
  title: string;
  due?: string | null;
  priority?: string | null;
}

export const STATUS_LABELS: Record<string, string> = {
  fleeting: "閃念",
  developing: "發展中",
  permanent: "永久筆記",
  exported: "已匯出",
  active: "進行中",
  done: "已完成",
  draft: "暫存",
  archived: "已封存",
};

export function formatNumberedList(header: string, items: ItemLike[], total: number): string {
  const countNote = total > 5 ? `共 ${total} 筆，顯示 5 筆` : `共 ${total} 筆`;
  const title = `${header}（${countNote}）`;
  const lines = items.map((item, i) => {
    let suffix = "";
    if (item.due) suffix += ` 📅${item.due}`;
    if (item.priority === "high") suffix += " ⚡";
    return `[${i + 1}] ${item.title}${suffix}`;
  });
  return [title, ...lines].join("\n");
}

const LINE_TEXT_MAX = 5000;

export function formatDetail(item: {
  title: string;
  type: string;
  status: string;
  priority: string | null;
  due: string | null;
  tags: string;
  content: string | null;
  origin?: string | null;
  source?: string | null;
}): string {
  const lines = [`📋 ${item.title}`];
  lines.push(`類型：${item.type === "todo" ? "待辦" : item.type === "scratch" ? "暫存" : "筆記"}`);
  lines.push(`狀態：${STATUS_LABELS[item.status] ?? item.status}`);
  if (item.priority) lines.push(`優先：${item.priority}`);
  if (item.due) lines.push(`到期：${item.due}`);
  const tags: string[] = JSON.parse(item.tags || "[]");
  if (tags.length > 0) lines.push(`標籤：${tags.join("、")}`);
  if (item.origin) lines.push(`來源：${item.origin}`);
  if (item.source) lines.push(`參考：${item.source}`);

  if (item.content) {
    const header = lines.join("\n");
    const remaining = LINE_TEXT_MAX - header.length - 2; // 2 for \n\n
    if (remaining > 50) {
      const content =
        item.content.length > remaining
          ? item.content.slice(0, remaining - 10) + "\n⋯（已截斷）"
          : item.content;
      lines.push(`\n${content}`);
    }
  }

  return lines.join("\n");
}

export function formatStats(stats: Stats): string {
  return `📊 Sparkle 統計
── 筆記 ──
閃念: ${stats.fleeting_count} | 發展中: ${stats.developing_count} | 永久: ${stats.permanent_count}
本週匯出: ${stats.exported_this_week} | 本月匯出: ${stats.exported_this_month}
── 待辦 ──
進行中: ${stats.active_count} | 本週完成: ${stats.done_this_week} | 本月完成: ${stats.done_this_month}
── 暫存 ──
暫存: ${stats.scratch_count}
── 整體 ──
本週新增: ${stats.created_this_week} | 逾期: ${stats.overdue_count}`;
}

const QUICK_REPLY_ITEMS = [
  {
    type: "action" as const,
    action: { type: "message" as const, label: "✨ 閃念", text: "!fleeting" },
  },
  {
    type: "action" as const,
    action: { type: "message" as const, label: "🔵 進行中", text: "!active" },
  },
  {
    type: "action" as const,
    action: { type: "message" as const, label: "📌 暫存", text: "!scratch" },
  },
  {
    type: "action" as const,
    action: { type: "message" as const, label: "📅 今日", text: "!today" },
  },
  { type: "action" as const, action: { type: "message" as const, label: "❓ 說明", text: "?" } },
];

export async function replyLine(
  token: string,
  replyToken: string,
  text: string,
  withQuickReply = false,
) {
  try {
    const message: Record<string, unknown> = { type: "text", text };
    if (withQuickReply) {
      message.quickReply = { items: QUICK_REPLY_ITEMS };
    }
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: [message],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body }, "LINE reply API error");
    }
  } catch (err) {
    logger.error({ err }, "Failed to reply LINE message");
  }
}

/**
 * Push a text message to a specific LINE user.
 * Returns true on success, false on failure.
 */
export async function pushLine(token: string, userId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: [{ type: "text", text }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body, userId }, "LINE push API error");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, userId }, "Failed to push LINE message");
    return false;
  }
}
