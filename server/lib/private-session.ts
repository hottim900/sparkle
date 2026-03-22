import { randomBytes } from "node:crypto";

const MAX_TOKENS = 10;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

const sessions = new Map<string, { createdAt: number }>();

export function createSession(): string {
  // LRU eviction: remove oldest if at max
  if (sessions.size >= MAX_TOKENS) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, val] of sessions) {
      if (val.createdAt < oldestTime) {
        oldestTime = val.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) sessions.delete(oldestKey);
  }

  const token = randomBytes(32).toString("hex");
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

export function validateSession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > DEFAULT_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

export function clearExpiredPrivateSessions(ttlMs = DEFAULT_TTL_MS): void {
  const now = Date.now();
  for (const [key, val] of sessions) {
    if (now - val.createdAt > ttlMs) {
      sessions.delete(key);
    }
  }
}

export function getSessionCount(): number {
  return sessions.size;
}
