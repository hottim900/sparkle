import type { CommandContext, CommandHandler } from "./types.js";
import { queryHandlers } from "./query-handlers.js";
import { itemHandlers } from "./item-handlers.js";
import { createHandlers } from "./create-handlers.js";
import { logger } from "../logger.js";

const handlers: Record<string, CommandHandler> = {
  ...queryHandlers,
  ...itemHandlers,
  ...createHandlers,
};

export async function dispatch(ctx: CommandContext): Promise<string | null> {
  const handler = handlers[ctx.command.type];
  if (!handler) return null;
  try {
    return await handler(ctx);
  } catch (err) {
    logger.error({ err, command: ctx.command.type, userId: ctx.userId }, "LINE command failed");
    return "❌ 操作失敗，請稍後再試";
  }
}
