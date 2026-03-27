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

describe("PUT /api/settings — daily note validation", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    mockGetSettings.mockReset();
    mockUpdateSettings.mockReset();
    mockGetSettings.mockReturnValue({ obsidian_enabled: "false" });
    app = createApp();
  });

  it("accepts valid daily_note_mode", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_note_mode: "append" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects invalid daily_note_mode", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_note_mode: "invalid" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("daily_note_mode");
  });

  it("accepts valid daily_note_time", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_note_time: "08:30" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects invalid daily_note_time (out of range)", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_note_time: "25:00" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects invalid daily_note_time (wrong format)", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_note_time: "8:30" }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts valid obsidian_daily_folder", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ obsidian_daily_folder: "Daily/Notes" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects obsidian_daily_folder with path traversal", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ obsidian_daily_folder: "../../etc" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("obsidian_daily_folder");
  });

  it("rejects obsidian_daily_folder with absolute path", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ obsidian_daily_folder: "/etc/passwd" }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts valid daily_note_enabled 'true'", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_note_enabled: "true" }),
    });
    expect(res.status).toBe(200);
  });

  it("accepts valid daily_note_enabled 'false'", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_note_enabled: "false" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects invalid daily_note_enabled", async () => {
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_note_enabled: "yes" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("daily_note_enabled");
  });
});
