import { Hono } from "hono";
import crypto from "node:crypto";
import { z } from "zod";
import { safeCompare } from "../lib/safe-compare.js";
import { logger } from "../lib/logger.js";
import { db, sqlite } from "../db/index.js";
import { parseCommand } from "../lib/line.js";
import { replyLine } from "../lib/line-format.js";
import { dispatch } from "../lib/line-commands/dispatcher.js";

const lineEventSchema = z.object({
  type: z.string(),
  message: z.object({ type: z.string(), text: z.string().optional() }).optional(),
  source: z.object({ userId: z.string() }).optional(),
  replyToken: z.string().optional(),
});

const lineWebhookSchema = z.object({
  events: z.array(lineEventSchema).default([]),
});

export const webhookRouter = new Hono();

function verifySignature(body: string, signature: string, secret: string): boolean {
  const hash = crypto.createHmac("SHA256", secret).update(body).digest("base64");
  return safeCompare(hash, signature);
}

webhookRouter.post("/line", async (c) => {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!channelSecret || !channelToken) {
    logger.error("LINE credentials not configured");
    return c.json({ error: "LINE not configured" }, 500);
  }

  const signature = c.req.header("x-line-signature");
  const rawBody = await c.req.text();

  if (!signature || !verifySignature(rawBody, signature, channelSecret)) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  let parsed: z.infer<typeof lineWebhookSchema>;
  try {
    const json: unknown = JSON.parse(rawBody);
    parsed = lineWebhookSchema.parse(json);
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const events = parsed.events;

  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text") {
      if (event.type === "message" && event.message?.type !== "text" && event.replyToken) {
        await replyLine(channelToken, event.replyToken, "📎 目前僅支援文字訊息");
      }
      continue;
    }

    if (!event.message?.text) continue;
    const text: string = event.message.text;
    const userId: string = event.source?.userId ?? "unknown";
    const cmd = parseCommand(text);

    if (!event.replyToken) continue;

    const reply = await dispatch({ userId, command: cmd, db, sqlite });
    if (reply) {
      await replyLine(channelToken, event.replyToken, reply, true);
    }
  }

  return c.json({ ok: true });
});
