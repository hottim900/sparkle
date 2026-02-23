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
        await replyMessage(channelToken, event.replyToken, `\u2705 \u5DF2\u5B58\u5165\u6536\u4EF6\u5323\uFF1A${item.title}`);
      }
    } catch (err) {
      console.error("Failed to create item from LINE:", err);
      if (event.replyToken) {
        await replyMessage(channelToken, event.replyToken, "\u274C \u5132\u5B58\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66");
      }
    }
  }

  return c.json({ ok: true });
});

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
