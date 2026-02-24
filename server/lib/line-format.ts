import type { Stats } from "./stats.js";

export interface ItemLike {
  id: string;
  title: string;
  due_date?: string | null;
  priority?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  inbox: "收件匣",
  active: "進行中",
  done: "已完成",
  archived: "已封存",
};

export function formatNumberedList(header: string, items: ItemLike[], total: number): string {
  const countNote = total > 5 ? `共 ${total} 筆，顯示 5 筆` : `共 ${total} 筆`;
  const title = `${header}（${countNote}）`;
  const lines = items.map((item, i) => {
    let suffix = "";
    if (item.due_date) suffix += ` 📅${item.due_date}`;
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
  due_date: string | null;
  tags: string;
  content: string | null;
}): string {
  const lines = [`📋 ${item.title}`];
  lines.push(`類型：${item.type === "todo" ? "待辦" : "筆記"}`);
  lines.push(`狀態：${STATUS_LABELS[item.status] ?? item.status}`);
  if (item.priority) lines.push(`優先：${item.priority}`);
  if (item.due_date) lines.push(`到期：${item.due_date}`);
  const tags: string[] = JSON.parse(item.tags || "[]");
  if (tags.length > 0) lines.push(`標籤：${tags.join("、")}`);

  if (item.content) {
    const header = lines.join("\n");
    const remaining = LINE_TEXT_MAX - header.length - 2; // 2 for \n\n
    if (remaining > 50) {
      const content = item.content.length > remaining
        ? item.content.slice(0, remaining - 10) + "\n⋯（已截斷）"
        : item.content;
      lines.push(`\n${content}`);
    }
  }

  return lines.join("\n");
}

export function formatStats(stats: Stats): string {
  return `📊 Sparkle 統計
📥 收件匣：${stats.inbox_count}
🔵 進行中：${stats.active_count}
⚠️ 逾期：${stats.overdue_count}
✅ 本週完成：${stats.completed_this_week}
✅ 本月完成：${stats.completed_this_month}`;
}

const QUICK_REPLY_ITEMS = [
  { type: "action" as const, action: { type: "message" as const, label: "📥 收件匣", text: "!inbox" } },
  { type: "action" as const, action: { type: "message" as const, label: "🔵 進行中", text: "!active" } },
  { type: "action" as const, action: { type: "message" as const, label: "📅 今日", text: "!today" } },
  { type: "action" as const, action: { type: "message" as const, label: "📊 統計", text: "!stats" } },
  { type: "action" as const, action: { type: "message" as const, label: "❓ 說明", text: "?" } },
];

export async function replyLine(token: string, replyToken: string, text: string, withQuickReply = false) {
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
      console.error("LINE reply API error:", res.status, body);
    }
  } catch (err) {
    console.error("Failed to reply LINE message:", err);
  }
}
