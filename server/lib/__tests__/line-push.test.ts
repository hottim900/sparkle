import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { pushLine } from "../line-format.js";

// --- Setup ---

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ============================================================
// pushLine
// ============================================================
describe("pushLine", () => {
  it("sends a push message and returns true on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    const result = await pushLine("token123", "user1", "Hello");

    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token123",
      },
      body: JSON.stringify({
        to: "user1",
        messages: [{ type: "text", text: "Hello" }],
      }),
    });
  });

  it("returns false on API error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve("Bad request"),
    });

    const result = await pushLine("token123", "user1", "Hello");

    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await pushLine("token123", "user1", "Hello");

    expect(result).toBe(false);
  });
});
