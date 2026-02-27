import type { Context, Next } from "hono";
import { safeCompare } from "../lib/safe-compare.js";

export async function authMiddleware(c: Context, next: Next) {
  const pathname = c.req.path;
  if (
    pathname.startsWith("/api/webhook/") ||
    pathname === "/api/public" ||
    pathname.startsWith("/api/public/")
  ) {
    return next();
  }

  const authToken = process.env.AUTH_TOKEN;

  if (!authToken) {
    console.warn("AUTH_TOKEN not set — all requests will be rejected");
    return c.json({ error: "Server misconfigured: no auth token set" }, 500);
  }

  const header = c.req.header("Authorization");

  if (!header) {
    return c.json({ error: "Missing Authorization header" }, 401);
  }

  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return c.json({ error: "Invalid Authorization format. Use: Bearer <token>" }, 401);
  }

  if (!safeCompare(token, authToken)) {
    return c.json({ error: "Invalid token" }, 401);
  }

  await next();
}
