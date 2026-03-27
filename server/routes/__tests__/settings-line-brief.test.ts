import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();

vi.mock("../../db/index.js", () => ({
  sqlite: {},
}));

vi.mock("../../lib/settings.js", () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
}));

import { Hono } from "hono";
import { settingsRouter } from "../settings.js";

function createApp() {
  const app = new Hono();
  app.route("/api/settings", settingsRouter);
  return app;
}

describe("PUT /api/settings — LINE brief validation", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    mockGetSettings.mockReset();
    mockUpdateSettings.mockReset();
    mockGetSettings.mockReturnValue({ obsidian_enabled: "false" });
    app = createApp();
  });

  it("accepts valid line_brief_enabled (true)", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line_brief_enabled: "true" }),
    });
    expect(res.status).toBe(200);
  });

  it("accepts valid line_brief_enabled (false)", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line_brief_enabled: "false" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects invalid line_brief_enabled", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line_brief_enabled: "yes" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("line_brief_enabled");
  });

  it("accepts valid line_brief_time", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line_brief_time: "21:00" }),
    });
    expect(res.status).toBe(200);
  });

  it("accepts line_brief_time at boundary (00:00)", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line_brief_time: "00:00" }),
    });
    expect(res.status).toBe(200);
  });

  it("accepts line_brief_time at boundary (23:59)", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line_brief_time: "23:59" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects invalid line_brief_time (out of range)", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line_brief_time: "25:00" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid line_brief_time (wrong format)", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line_brief_time: "9:30" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid line_brief_time (non-time string)", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line_brief_time: "morning" }),
    });
    expect(res.status).toBe(400);
  });
});
