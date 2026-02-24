import { Hono } from "hono";
import crypto from "node:crypto";
import { db, sqlite } from "../db/index.js";
import { createItem, getItem, listItems, searchItems, updateItem } from "../lib/items.js";
import { getStats, getFocusItems } from "../lib/stats.js";
import { parseCommand } from "../lib/line.js";
import { setSession, getItemId } from "../lib/line-session.js";
import { parseDate } from "../lib/line-date.js";
import { formatNumberedList, formatDetail, formatStats, replyLine } from "../lib/line-format.js";

export const webhookRouter = new Hono();

function verifySignature(body: string, signature: string, secret: string): boolean {
  const hash = crypto.createHmac("SHA256", secret).update(body).digest("base64");
  return hash === signature;
}

function resolveSessionItem(userId: string, index: number) {
  const itemId = getItemId(userId, index);
  if (!itemId) return { error: `❌ 編號 ${index} 不存在，請重新查詢` } as const;
  const item = getItem(db, itemId);
  if (!item) return { error: "❌ 項目不存在" } as const;
  return { itemId, item } as const;
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
        await replyLine(channelToken, event.replyToken, "📎 目前僅支援文字訊息");
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
        await replyLine(channelToken, event.replyToken, HELP_TEXT);
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
        const resolved = resolveSessionItem(userId, cmd.index);
        if ("error" in resolved) { reply = resolved.error; break; }
        reply = formatDetail(resolved.item);
        break;
      }

      case "due": {
        const resolved = resolveSessionItem(userId, cmd.index);
        if ("error" in resolved) { reply = resolved.error; break; }
        const dateParsed = parseDate(cmd.dateInput);
        if (!dateParsed.success) {
          reply = "❌ 無法辨識日期，請用 YYYY-MM-DD 或中文如『明天』『3天後』";
          break;
        }
        const dueDate = dateParsed.clear ? null : dateParsed.date;
        updateItem(db, resolved.itemId, { due_date: dueDate });
        const dueItem = getItem(db, resolved.itemId);
        reply = dateParsed.clear
          ? `✅ 已清除「${dueItem!.title}」的到期日`
          : `✅ 已設定「${dueItem!.title}」到期日為 ${dueDate}`;
        break;
      }

      case "tag": {
        const resolved = resolveSessionItem(userId, cmd.index);
        if ("error" in resolved) { reply = resolved.error; break; }
        const existingTags: string[] = JSON.parse(resolved.item.tags || "[]");
        const newTags = [...new Set([...existingTags, ...cmd.tags])];
        updateItem(db, resolved.itemId, { tags: newTags });
        reply = `✅ 已為「${resolved.item.title}」加上標籤：${cmd.tags.join("、")}`;
        break;
      }

      case "done": {
        const resolved = resolveSessionItem(userId, cmd.index);
        if ("error" in resolved) { reply = resolved.error; break; }
        updateItem(db, resolved.itemId, { status: "done" });
        reply = `✅ 已將「${resolved.item.title}」標記為已完成`;
        break;
      }

      case "archive": {
        const resolved = resolveSessionItem(userId, cmd.index);
        if ("error" in resolved) { reply = resolved.error; break; }
        updateItem(db, resolved.itemId, { status: "archived" });
        reply = `✅ 已封存「${resolved.item.title}」`;
        break;
      }

      case "priority": {
        const resolved = resolveSessionItem(userId, cmd.index);
        if ("error" in resolved) { reply = resolved.error; break; }
        updateItem(db, resolved.itemId, { priority: cmd.priority });
        reply = cmd.priority === null
          ? `✅ 已清除「${resolved.item.title}」的優先度`
          : `✅ 已將「${resolved.item.title}」優先度設為 ${cmd.priority}`;
        break;
      }

      case "untag": {
        const resolved = resolveSessionItem(userId, cmd.index);
        if ("error" in resolved) { reply = resolved.error; break; }
        const currentTags: string[] = JSON.parse(resolved.item.tags || "[]");
        const remaining = currentTags.filter((t) => !cmd.tags.includes(t));
        updateItem(db, resolved.itemId, { tags: remaining });
        reply = `✅ 已從「${resolved.item.title}」移除標籤：${cmd.tags.join("、")}`;
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
          await replyLine(channelToken, event.replyToken, "❌ 儲存失敗，請稍後再試");
          continue;
        }
        break;
      }

      case "unknown":
      default:
        continue;
    }

    await replyLine(channelToken, event.replyToken, reply!, true);
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
!untag N 標籤 → 移除標籤
!done N → 標記為已完成
!archive N → 封存
!priority N high/medium/low/none → 設定優先度

日期格式：明天、3天後、下週一、3/15、2026-03-15
清除到期日：!due N 清除

輸入 ? 顯示此說明`;
