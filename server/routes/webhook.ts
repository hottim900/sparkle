import { Hono } from "hono";
import crypto from "node:crypto";
import { db, sqlite } from "../db/index.js";
import { createItem, getItem, listItems, searchItems, updateItem } from "../lib/items.js";
import { getStats, getFocusItems } from "../lib/stats.js";
import { parseCommand } from "../lib/line.js";
import { setSession, getItemId } from "../lib/line-session.js";
import { parseDate } from "../lib/line-date.js";
import { formatNumberedList, formatDetail, formatStats } from "../lib/line-format.js";

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
        await replyMessage(channelToken, event.replyToken, "📎 目前僅支援文字訊息");
      }
      continue;
    }

    const text: string = event.message.text;
    const userId: string = event.source?.userId ?? "unknown";
    const cmd = parseCommand(text);

    if (!event.replyToken) continue;

    let reply: string;

    switch (cmd.type) {
      case "help": {
        await replyMessage(channelToken, event.replyToken, HELP_TEXT);
        continue;
      }

      case "find": {
        try {
          const results = searchItems(sqlite, cmd.keyword, 5);
          if (results.length === 0) {
            reply = `🔍 找不到「${cmd.keyword}」相關的項目`;
          } else {
            setSession(userId, results.map((r) => r.id));
            reply = formatNumberedList(`🔍 搜尋「${cmd.keyword}」`, results, results.length);
          }
        } catch {
          reply = `🔍 找不到「${cmd.keyword}」相關的項目`;
        }
        break;
      }

      case "inbox": {
        const { items: inboxItems, total } = listItems(db, {
          status: "inbox",
          sort: "created_at",
          order: "desc",
          limit: 5,
        });
        if (total === 0) {
          reply = "📥 收件匣是空的！";
        } else {
          setSession(userId, inboxItems.map((r) => r.id));
          reply = formatNumberedList("📥 收件匣", inboxItems, total);
        }
        break;
      }

      case "today": {
        const focusItems = getFocusItems(sqlite);
        if (focusItems.length === 0) {
          reply = "📅 今天沒有待處理的項目！";
        } else {
          setSession(userId, focusItems.map((r) => r.id));
          reply = formatNumberedList("📅 今日焦點", focusItems, focusItems.length);
        }
        break;
      }

      case "stats": {
        const stats = getStats(sqlite);
        reply = formatStats(stats);
        break;
      }

      case "active": {
        const { items: activeItems, total } = listItems(db, {
          status: "active",
          sort: "due_date",
          order: "asc",
          limit: 5,
        });
        if (total === 0) {
          reply = "🔵 沒有進行中的項目";
        } else {
          setSession(userId, activeItems.map((r) => r.id));
          reply = formatNumberedList("🔵 進行中", activeItems, total);
        }
        break;
      }

      case "notes": {
        const { items: noteItems, total } = listItems(db, {
          type: "note",
          sort: "created_at",
          order: "desc",
          limit: 5,
        });
        if (total === 0) {
          reply = "📝 沒有筆記";
        } else {
          setSession(userId, noteItems.map((r) => r.id));
          reply = formatNumberedList("📝 筆記", noteItems, total);
        }
        break;
      }

      case "todos": {
        const { items: todoItems, total } = listItems(db, {
          type: "todo",
          sort: "created_at",
          order: "desc",
          limit: 5,
        });
        if (total === 0) {
          reply = "☑️ 沒有待辦事項";
        } else {
          setSession(userId, todoItems.map((r) => r.id));
          reply = formatNumberedList("☑️ 待辦事項", todoItems, total);
        }
        break;
      }

      case "list": {
        const { items: tagItems, total } = listItems(db, {
          tag: cmd.tag,
          limit: 5,
        });
        if (total === 0) {
          reply = `🏷️ 找不到標籤「${cmd.tag}」的項目`;
        } else {
          setSession(userId, tagItems.map((r) => r.id));
          reply = formatNumberedList(`🏷️ 標籤「${cmd.tag}」`, tagItems, total);
        }
        break;
      }

      case "detail": {
        const detailItemId = getItemId(userId, cmd.index);
        if (!detailItemId) {
          reply = `❌ 編號 ${cmd.index} 不存在，請重新查詢`;
          break;
        }
        const detailItem = getItem(db, detailItemId);
        if (!detailItem) {
          reply = "❌ 項目不存在";
          break;
        }
        reply = formatDetail(detailItem);
        break;
      }

      case "due": {
        const dueItemId = getItemId(userId, cmd.index);
        if (!dueItemId) {
          reply = `❌ 編號 ${cmd.index} 不存在，請重新查詢`;
          break;
        }
        const dateParsed = parseDate(cmd.dateInput);
        if (!dateParsed.success) {
          reply = "❌ 無法辨識日期，請用 YYYY-MM-DD 或中文如『明天』『3天後』";
          break;
        }
        const dueDate = dateParsed.clear ? null : dateParsed.date;
        updateItem(db, dueItemId, { due_date: dueDate });
        const dueItem = getItem(db, dueItemId);
        reply = dateParsed.clear
          ? `✅ 已清除「${dueItem!.title}」的到期日`
          : `✅ 已設定「${dueItem!.title}」到期日為 ${dueDate}`;
        break;
      }

      case "tag": {
        const tagItemId = getItemId(userId, cmd.index);
        if (!tagItemId) {
          reply = `❌ 編號 ${cmd.index} 不存在，請重新查詢`;
          break;
        }
        const tagItem = getItem(db, tagItemId);
        if (!tagItem) {
          reply = "❌ 項目不存在";
          break;
        }
        const existingTags: string[] = JSON.parse(tagItem.tags || "[]");
        const newTags = [...new Set([...existingTags, ...cmd.tags])];
        updateItem(db, tagItemId, { tags: newTags });
        reply = `✅ 已為「${tagItem.title}」加上標籤：${cmd.tags.join("、")}`;
        break;
      }

      case "save": {
        if (!cmd.parsed.title) continue;
        try {
          const item = createItem(db, {
            title: cmd.parsed.title,
            content: cmd.parsed.content,
            type: cmd.parsed.type,
            status: "inbox",
            priority: cmd.parsed.priority,
            source: cmd.parsed.source,
          });
          const typeLabel = item.type === "todo" ? "待辦" : "筆記";
          const priorityLabel = cmd.parsed.priority === "high" ? " [高優先]" : "";
          reply = `✅ 已存入收件匣（${typeLabel}${priorityLabel}）\n${item.title}`;
        } catch (err) {
          console.error("Failed to create item from LINE:", err);
          await replyMessage(channelToken, event.replyToken, "❌ 儲存失敗，請稍後再試");
          continue;
        }
        break;
      }

      case "unknown":
      default:
        continue;
    }

    await replyWithQuickReply(channelToken, event.replyToken, reply!);
  }

  return c.json({ ok: true });
});

const HELP_TEXT = `📝 Sparkle 使用說明

【新增】
直接輸入文字 → 存為筆記
!todo 買牛奶 → 存為待辦
!high 緊急事項 → 高優先筆記
!todo !high 繳費 → 高優先待辦

多行訊息：第一行為標題，其餘為內容

【查詢】
!inbox → 查看收件匣
!active → 進行中項目
!notes → 所有筆記
!todos → 所有待辦
!today → 今日焦點
!find 關鍵字 → 搜尋項目
!list 標籤 → 按標籤篩選
!stats → 統計摘要

【操作】查詢後用編號操作
!detail N → 查看第 N 筆詳情
!due N 日期 → 設定到期日
!tag N 標籤 → 加標籤

日期格式：明天、3天後、下週一、3/15、2026-03-15
清除到期日：!due N 清除

輸入 ? 顯示此說明`;

async function replyWithQuickReply(token: string, replyToken: string, text: string) {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
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
              { type: "action", action: { type: "message", label: "📥 收件匣", text: "!inbox" } },
              { type: "action", action: { type: "message", label: "🔵 進行中", text: "!active" } },
              { type: "action", action: { type: "message", label: "📅 今日", text: "!today" } },
              { type: "action", action: { type: "message", label: "📊 統計", text: "!stats" } },
              { type: "action", action: { type: "message", label: "❓ 說明", text: "?" } },
            ],
          },
        }],
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

async function replyMessage(token: string, replyToken: string, text: string) {
  try {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
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
    if (!res.ok) {
      const body = await res.text();
      console.error("LINE reply API error:", res.status, body);
    }
  } catch (err) {
    console.error("Failed to reply LINE message:", err);
  }
}

