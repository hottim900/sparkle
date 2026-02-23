import { Hono } from "hono";
import crypto from "node:crypto";
import { db } from "../db/index.js";
import { createItem } from "../lib/items.js";
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

const HELP_TEXT = `📝 Sparkle 使用說明

直接輸入文字 → 存為筆記
!todo 買牛奶 → 存為待辦
!high 緊急事項 → 高優先筆記
!todo !high 繳費 → 高優先待辦

多行訊息：第一行為標題，其餘為內容

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
              { type: "action", action: { type: "message", label: "📝 筆記", text: "" } },
              { type: "action", action: { type: "message", label: "✅ 待辦", text: "!todo " } },
              { type: "action", action: { type: "message", label: "🔴 緊急", text: "!todo !high " } },
              { type: "action", action: { type: "message", label: "❓ 說明", text: "?" } },
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
