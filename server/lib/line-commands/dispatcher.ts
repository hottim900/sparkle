import type { CommandContext, CommandHandler } from "./types.js";
import { queryHandlers } from "./query-handlers.js";
import { itemHandlers } from "./item-handlers.js";
import { createHandlers } from "./create-handlers.js";

const handlers: Record<string, CommandHandler> = {
  ...queryHandlers,
  ...itemHandlers,
  ...createHandlers,
};

export async function dispatch(ctx: CommandContext): Promise<string | null> {
  const handler = handlers[ctx.command.type];
  if (!handler) return null;
  return handler(ctx);
}
