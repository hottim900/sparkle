import type { Context, Next } from "hono";
import { validateSession } from "../lib/private-session";

export async function privateTokenMiddleware(c: Context, next: Next) {
  const token = c.req.header("X-Private-Token");
  if (!token || !validateSession(token)) {
    return c.json({ error: "Private session required" }, 401);
  }
  await next();
}
