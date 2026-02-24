import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setSession, getItemId, clearExpiredSessions, SESSION_TTL_MS } from "../line-session.js";

describe("line-session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("setSession stores mapping and getItemId retrieves by index", () => {
    setSession("user1", ["uuid-a", "uuid-b", "uuid-c"]);
    expect(getItemId("user1", 1)).toBe("uuid-a");
    expect(getItemId("user1", 2)).toBe("uuid-b");
    expect(getItemId("user1", 3)).toBe("uuid-c");
  });

  it("getItemId returns null for non-existent index", () => {
    setSession("user1", ["uuid-a"]);
    expect(getItemId("user1", 2)).toBeNull();
    expect(getItemId("user1", 0)).toBeNull();
  });

  it("getItemId returns null for non-existent userId", () => {
    expect(getItemId("nonexistent", 1)).toBeNull();
  });

  it("setSession overwrites previous session for same userId", () => {
    setSession("user1", ["uuid-a", "uuid-b"]);
    setSession("user1", ["uuid-x"]);
    expect(getItemId("user1", 1)).toBe("uuid-x");
    expect(getItemId("user1", 2)).toBeNull();
  });

  it("getItemId returns null when session is expired", () => {
    setSession("user1", ["uuid-a"]);
    expect(getItemId("user1", 1)).toBe("uuid-a");

    vi.advanceTimersByTime(SESSION_TTL_MS + 1);
    expect(getItemId("user1", 1)).toBeNull();
  });

  it("clearExpiredSessions removes only expired sessions", () => {
    setSession("user1", ["uuid-a"]);
    vi.advanceTimersByTime(SESSION_TTL_MS + 1);
    setSession("user2", ["uuid-b"]);

    clearExpiredSessions();
    expect(getItemId("user1", 1)).toBeNull();
    expect(getItemId("user2", 1)).toBe("uuid-b");
  });
});
