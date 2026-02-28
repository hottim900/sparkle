import { rateLimiter } from "hono-rate-limiter";
import type { Context } from "hono";

function getClientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown"
  );
}

// General API rate limit: 200 req/min per IP
export const apiRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 200,
  keyGenerator: getClientIp,
  standardHeaders: "draft-7",
  message: { error: "Too many requests, please try again later" },
});

// Auth failure rate limit: 5 failures/min per IP (brute-force protection)
// skipSuccessfulRequests means only non-2xx responses count toward the limit
export const authFailRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 5,
  keyGenerator: getClientIp,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  requestPropertyName: "authRateLimit",
  message: { error: "Too many failed attempts, please try again later" },
});

// Webhook rate limit: 30 req/min per IP
export const webhookRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: getClientIp,
  standardHeaders: "draft-7",
  requestPropertyName: "webhookRateLimit",
  message: { error: "Too many requests" },
});
