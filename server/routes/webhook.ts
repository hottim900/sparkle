import { Hono } from "hono";
import crypto from "node:crypto";
import { db, sqlite } from "../db/index.js";
import { createItem, listItems, searchItems } from "../lib/items.js";
import { getStats, getFocusItems } from "../lib/stats.js";
import { parseLineMessage } from "../lib/line.js";

export const webhookRouter = new Hono();

function verifySignature(body: string, signature: string, secret: string): boolean {
  const hash = crypto.createHmac("SHA256", secret).update(body).digest("base64");
  return hash === signature;
}

webhookRouter.post("/line", async (c) => {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!channelSecret || !channelToken) {
    console.error("LINE credentials not configured");
    return c.json({ error: "LINE not configured" }, 500);
  }

  const signature = c.req.header("x-line-signature");
  const rawBody = await c.req.text();

  if (!signature || !verifySignature(rawBody, signature, channelSecret)) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  const body = JSON.parse(rawBody);
  const events = body.events ?? [];

  for (const event of events) {
    if (event.type !== "message" || event.message.type !== "text") {
      if (event.type === "message" && event.message.type !== "text" && event.replyToken) {
        await replyMessage(channelToken, event.replyToken, "\u{1F4CE} \u76EE\u524D\u50C5\u652F\u63F4\u6587\u5B57\u8A0A\u606F");
      }
      continue;
    }

    const text: string = event.message.text;
    const trimmed = text.trim().toLowerCase();

    // Help command
    if (trimmed === "?" || trimmed === "help" || trimmed === "說明") {
      if (event.replyToken) {
        await replyMessage(channelToken, event.replyToken, HELP_TEXT);
      }
      continue;
    }

    // Query commands
    if (trimmed.startsWith("!find ")) {
      const keyword = text.trim().slice(6).trim();
      if (keyword && event.replyToken) {
        try {
          const results = searchItems(sqlite, keyword, 5);
          const reply = results.length === 0
            ? `\u{1F50D} 找不到「${keyword}」相關的項目`
            : formatSearchResults(keyword, results);
          await replyWithQuickReply(channelToken, event.replyToken, reply);
        } catch {
          await replyWithQuickReply(channelToken, event.replyToken, `\u{1F50D} 找不到「${keyword}」相關的項目`);
        }
      }
      continue;
    }

    if (trimmed === "!inbox") {
      if (event.replyToken) {
        const { items: inboxItems, total } = listItems(db, {
          status: "inbox",
          sort: "created_at",
          order: "desc",
          limit: 5,
        });
        const reply = total === 0
          ? "\u{1F4E5} 收件匣是空的！"
          : formatInboxResults(inboxItems, total);
        await replyWithQuickReply(channelToken, event.replyToken, reply);
      }
      continue;
    }

    if (trimmed === "!today") {
      if (event.replyToken) {
        const focusItems = getFocusItems(sqlite);
        const reply = focusItems.length === 0
          ? "\u{1F4C5} 今天沒有待處理的項目！"
          : formatFocusResults(focusItems);
        await replyWithQuickReply(channelToken, event.replyToken, reply);
      }
      continue;
    }

    if (trimmed === "!stats") {
      if (event.replyToken) {
        const stats = getStats(sqlite);
        const reply = formatStats(stats);
        await replyWithQuickReply(channelToken, event.replyToken, reply);
      }
      continue;
    }

    const parsed = parseLineMessage(text);

    if (!parsed.title) continue;

    try {
      const item = createItem(db, {
        title: parsed.title,
        content: parsed.content,
        type: parsed.type,
        status: "inbox",
        priority: parsed.priority,
        source: parsed.source,
      });

      if (event.replyToken) {
        const typeLabel = item.type === "todo" ? "待辦" : "筆記";
        const priorityLabel = parsed.priority === "high" ? " [高優先]" : "";
        await replyWithQuickReply(
          channelToken,
          event.replyToken,
          `\u2705 已存入收件匣（${typeLabel}${priorityLabel}）\n${item.title}`,
        );
      }
    } catch (err) {
      console.error("Failed to create item from LINE:", err);
      if (event.replyToken) {
        await replyMessage(channelToken, event.replyToken, "\u274C 儲存失敗，請稍後再試");
      }
    }
  }

  return c.json({ ok: true });
});

const HELP_TEXT = `\u{1F4DD} Sparkle 使用說明

【新增】
直接輸入文字 \u2192 存為筆記
!todo 買牛奶 \u2192 存為待辦
!high 緊急事項 \u2192 高優先筆記
!todo !high 繳費 \u2192 高優先待辦

多行訊息：第一行為標題，其餘為內容

【查詢】
!inbox \u2192 查看收件匣
!today \u2192 今日焦點
!find 關鍵字 \u2192 搜尋項目
!stats \u2192 統計摘要

輸入 ? 顯示此說明`;

async function replyWithQuickReply(token: string, replyToken: string, text: string) {
  try {
    await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: [{
          type: "text",
          text,
          quickReply: {
            items: [
              { type: "action", action: { type: "message", label: "\u{1F4DD} 筆記", text: "" } },
              { type: "action", action: { type: "message", label: "\u2705 待辦", text: "!todo " } },
              { type: "action", action: { type: "message", label: "\u{1F4E5} 收件匣", text: "!inbox" } },
              { type: "action", action: { type: "message", label: "\u{1F4C5} 今日", text: "!today" } },
              { type: "action", action: { type: "message", label: "\u2753 說明", text: "?" } },
            ],
          },
        }],
      }),
    });
  } catch (err) {
    console.error("Failed to reply LINE message:", err);
  }
}

async function replyMessage(token: string, replyToken: string, text: string) {
  try {
    await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: "text", text }],
      }),
    });
  } catch (err) {
    console.error("Failed to reply LINE message:", err);
  }
}

function formatSearchResults(keyword: string, results: { title: string }[]): string {
  const header = `\u{1F50D} 搜尋「${keyword}」（找到 ${results.length} 筆）`;
  const lines = results.map((item, i) => `${i + 1}. ${item.title}`);
  return [header, ...lines].join("\n");
}

function formatInboxResults(inboxItems: { title: string }[], total: number): string {
  const countNote = total > 5 ? `共 ${total} 筆，顯示最新 5 筆` : `共 ${total} 筆`;
  const header = `\u{1F4E5} 收件匣（${countNote}）`;
  const lines = inboxItems.map((item, i) => `${i + 1}. ${item.title}`);
  return [header, ...lines].join("\n");
}

function formatFocusResults(focusItems: { title: string; due_date: string | null }[]): string {
  const today = new Date();
  const todayStr = toLocalDateStr(today);

  const header = "\u{1F4C5} 今日焦點";
  const lines = focusItems.map((item, i) => {
    let tag = "";
    if (item.due_date) {
      if (item.due_date < todayStr) tag = " [逾期]";
      else if (item.due_date === todayStr) tag = " [今日]";
      else tag = ` [${item.due_date}]`;
    }
    return `${i + 1}.${tag} ${item.title}`;
  });
  return [header, ...lines].join("\n");
}

function formatStats(stats: import("../lib/stats.js").Stats): string {
  return `\u{1F4CA} Sparkle 統計
\u{1F4E5} 收件匣：${stats.inbox_count}
\u{1F535} 進行中：${stats.active_count}
\u26A0\uFE0F 逾期：${stats.overdue_count}
\u2705 本週完成：${stats.completed_this_week}
\u2705 本月完成：${stats.completed_this_month}`;
}

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
