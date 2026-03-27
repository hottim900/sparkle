import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";

describe("HSTS header", () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  function createAppWithSecurityHeaders(nodeEnv: string | undefined) {
    process.env.NODE_ENV = nodeEnv;
    const app = new Hono();
    app.use("*", async (c, next) => {
      await next();
      c.res.headers.set("X-Content-Type-Options", "nosniff");
      c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      c.res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      if (process.env.NODE_ENV === "production") {
        c.res.headers.set(
          "Strict-Transport-Security",
          "max-age=63072000; includeSubDomains; preload",
        );
      }
    });
    app.get("/test", (c) => c.text("ok"));
    return app;
  }

  it("sets HSTS header in production", async () => {
    const app = createAppWithSecurityHeaders("production");
    const res = await app.request("/test");
    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });

  it("does not set HSTS header in development", async () => {
    const app = createAppWithSecurityHeaders("development");
    const res = await app.request("/test");
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("does not set HSTS header when NODE_ENV is undefined", async () => {
    const app = createAppWithSecurityHeaders(undefined);
    const res = await app.request("/test");
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("does not set HSTS header in test environment", async () => {
    const app = createAppWithSecurityHeaders("test");
    const res = await app.request("/test");
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("always sets other security headers regardless of environment", async () => {
    const app = createAppWithSecurityHeaders("development");
    const res = await app.request("/test");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
  });
});
