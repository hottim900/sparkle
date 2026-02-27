import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import type { Context } from "hono";

// We test the rate limiting behavior directly using hono-rate-limiter
// rather than importing from our module, to keep tests isolated and fast.

function getClientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}

describe("Rate limiting", () => {
  describe("General API rate limit", () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.use(
        "/api/*",
        rateLimiter({
          windowMs: 60 * 1000,
          limit: 5,
          keyGenerator: getClientIp,
          standardHeaders: "draft-7",
          message: { error: "Too many requests, please try again later" },
        }),
      );
      app.get("/api/test", (c) => c.json({ ok: true }));
    });

    it("allows requests within the limit", async () => {
      for (let i = 0; i < 5; i++) {
        const res = await app.request("/api/test", {
          headers: { "x-forwarded-for": "1.2.3.4" },
        });
        expect(res.status).toBe(200);
      }
    });

    it("blocks requests exceeding the limit with 429", async () => {
      for (let i = 0; i < 5; i++) {
        await app.request("/api/test", {
          headers: { "x-forwarded-for": "1.2.3.4" },
        });
      }

      const res = await app.request("/api/test", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      });
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toMatch(/too many requests/i);
    });

    it("tracks different IPs independently", async () => {
      // Exhaust limit for IP A
      for (let i = 0; i < 5; i++) {
        await app.request("/api/test", {
          headers: { "x-forwarded-for": "1.2.3.4" },
        });
      }

      // IP A is blocked
      const blockedRes = await app.request("/api/test", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      });
      expect(blockedRes.status).toBe(429);

      // IP B is still allowed
      const allowedRes = await app.request("/api/test", {
        headers: { "x-forwarded-for": "5.6.7.8" },
      });
      expect(allowedRes.status).toBe(200);
    });

    it("returns rate limit headers", async () => {
      const res = await app.request("/api/test", {
        headers: { "x-forwarded-for": "10.0.0.1" },
      });
      expect(res.status).toBe(200);
      // draft-7 uses "ratelimit" header
      const rateLimitHeader = res.headers.get("ratelimit");
      expect(rateLimitHeader).toBeTruthy();
    });

    it("extracts first IP from x-forwarded-for chain", async () => {
      // Both requests use the same first IP, so they share a counter
      for (let i = 0; i < 5; i++) {
        await app.request("/api/test", {
          headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
        });
      }

      const res = await app.request("/api/test", {
        headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.2" },
      });
      expect(res.status).toBe(429);
    });

    it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
      for (let i = 0; i < 5; i++) {
        await app.request("/api/test", {
          headers: { "x-real-ip": "192.168.1.1" },
        });
      }

      const res = await app.request("/api/test", {
        headers: { "x-real-ip": "192.168.1.1" },
      });
      expect(res.status).toBe(429);

      // Different x-real-ip should still work
      const otherRes = await app.request("/api/test", {
        headers: { "x-real-ip": "192.168.1.2" },
      });
      expect(otherRes.status).toBe(200);
    });
  });

  describe("Auth failure rate limit (skipSuccessfulRequests)", () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.use(
        "/api/*",
        rateLimiter({
          windowMs: 60 * 1000,
          limit: 3,
          keyGenerator: getClientIp,
          skipSuccessfulRequests: true,
          requestPropertyName: "authRateLimit",
          message: { error: "Too many failed attempts, please try again later" },
        }),
      );
      // Simulate auth: token "valid" succeeds, anything else fails with 401
      app.use("/api/*", async (c, next) => {
        const token = c.req.header("authorization");
        if (token === "Bearer valid") {
          return next();
        }
        return c.json({ error: "Invalid token" }, 401);
      });
      app.get("/api/test", (c) => c.json({ ok: true }));
    });

    it("does not count successful requests toward the limit", async () => {
      // Make many successful requests — should not hit the limit
      for (let i = 0; i < 10; i++) {
        const res = await app.request("/api/test", {
          headers: { "x-forwarded-for": "1.2.3.4", authorization: "Bearer valid" },
        });
        expect(res.status).toBe(200);
      }
    });

    it("counts failed requests and blocks after limit", async () => {
      // 3 failed attempts
      for (let i = 0; i < 3; i++) {
        const res = await app.request("/api/test", {
          headers: { "x-forwarded-for": "1.2.3.4", authorization: "Bearer wrong" },
        });
        expect(res.status).toBe(401);
      }

      // 4th attempt — rate limited
      const res = await app.request("/api/test", {
        headers: { "x-forwarded-for": "1.2.3.4", authorization: "Bearer wrong" },
      });
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toMatch(/too many failed attempts/i);
    });

    it("blocks even valid requests after too many failures from same IP", async () => {
      // 3 failed attempts
      for (let i = 0; i < 3; i++) {
        await app.request("/api/test", {
          headers: { "x-forwarded-for": "1.2.3.4", authorization: "Bearer wrong" },
        });
      }

      // Now try with a valid token — still blocked by rate limiter (429 before auth runs)
      const res = await app.request("/api/test", {
        headers: { "x-forwarded-for": "1.2.3.4", authorization: "Bearer valid" },
      });
      expect(res.status).toBe(429);
    });
  });

  describe("Webhook rate limit", () => {
    let app: Hono;

    beforeEach(() => {
      app = new Hono();
      app.use(
        "/api/webhook/*",
        rateLimiter({
          windowMs: 60 * 1000,
          limit: 3,
          keyGenerator: getClientIp,
          requestPropertyName: "webhookRateLimit",
          message: { error: "Too many requests" },
        }),
      );
      app.post("/api/webhook/line", (c) => c.json({ ok: true }));
    });

    it("allows webhook requests within the limit", async () => {
      for (let i = 0; i < 3; i++) {
        const res = await app.request("/api/webhook/line", {
          method: "POST",
          headers: { "x-forwarded-for": "10.0.0.1" },
        });
        expect(res.status).toBe(200);
      }
    });

    it("blocks webhook requests exceeding the limit", async () => {
      for (let i = 0; i < 3; i++) {
        await app.request("/api/webhook/line", {
          method: "POST",
          headers: { "x-forwarded-for": "10.0.0.1" },
        });
      }

      const res = await app.request("/api/webhook/line", {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.1" },
      });
      expect(res.status).toBe(429);
    });
  });

  describe("Window reset", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("resets the counter after window expires", async () => {
      const app = new Hono();
      app.use(
        "/api/*",
        rateLimiter({
          windowMs: 60 * 1000,
          limit: 2,
          keyGenerator: getClientIp,
        }),
      );
      app.get("/api/test", (c) => c.text("ok"));

      // Exhaust the limit
      for (let i = 0; i < 2; i++) {
        const res = await app.request("/api/test", {
          headers: { "x-forwarded-for": "1.2.3.4" },
        });
        expect(res.status).toBe(200);
      }

      // Blocked
      const blocked = await app.request("/api/test", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      });
      expect(blocked.status).toBe(429);

      // Advance time past the window
      vi.advanceTimersByTime(61 * 1000);

      // Should be allowed again
      const res = await app.request("/api/test", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      });
      expect(res.status).toBe(200);
    });
  });
});
