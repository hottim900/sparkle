import type { Context, Next } from "hono";
import { logger } from "../lib/logger.js";

export async function requestLogger(c: Context, next: Next) {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  const level = c.req.path === "/api/health" ? "debug" : "info";
  logger[level](
    { method: c.req.method, path: c.req.path, status: c.res.status, responseTime: ms },
    `${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`,
  );
}
