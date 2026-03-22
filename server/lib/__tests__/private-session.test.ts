import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createSession,
  validateSession,
  destroySession,
  clearExpiredPrivateSessions,
  getSessionCount,
} from "../private-session";

describe("Private session tokens", () => {
  beforeEach(() => {
    // Clear all sessions between tests
    clearExpiredPrivateSessions(0); // TTL=0 clears all
  });

  it("creates a session token (64-char hex)", () => {
    const token = createSession();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("validates a valid token", () => {
    const token = createSession();
    expect(validateSession(token)).toBe(true);
  });

  it("rejects unknown token", () => {
    expect(validateSession("nonexistent")).toBe(false);
  });

  it("destroys a session", () => {
    const token = createSession();
    destroySession(token);
    expect(validateSession(token)).toBe(false);
  });

  it("enforces max 10 tokens (LRU eviction)", () => {
    const tokens: string[] = [];
    for (let i = 0; i < 11; i++) {
      tokens.push(createSession());
    }
    // First token should be evicted
    expect(validateSession(tokens[0]!)).toBe(false);
    // Last token should be valid
    expect(validateSession(tokens[10]!)).toBe(true);
  });

  it("clears expired sessions", () => {
    vi.useFakeTimers();
    const token = createSession();
    vi.advanceTimersByTime(31 * 60 * 1000); // 31 minutes
    clearExpiredPrivateSessions();
    expect(validateSession(token)).toBe(false);
    vi.useRealTimers();
  });

  it("getSessionCount returns current count", () => {
    createSession();
    createSession();
    expect(getSessionCount()).toBe(2);
  });
});
