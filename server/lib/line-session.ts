interface Session {
  items: Map<number, string>; // 1-based index → item UUID
  updatedAt: Date;
}

const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function setSession(userId: string, itemIds: string[]): void {
  const items = new Map<number, string>();
  itemIds.forEach((id, i) => items.set(i + 1, id));
  sessions.set(userId, { items, updatedAt: new Date() });
}

export function getItemId(userId: string, index: number): string | null {
  const session = sessions.get(userId);
  if (!session) return null;
  if (Date.now() - session.updatedAt.getTime() > SESSION_TTL_MS) {
    sessions.delete(userId);
    return null;
  }
  return session.items.get(index) ?? null;
}

export function clearExpiredSessions(): void {
  const now = Date.now();
  for (const [userId, session] of sessions) {
    if (now - session.updatedAt.getTime() > SESSION_TTL_MS) {
      sessions.delete(userId);
    }
  }
}

export { SESSION_TTL_MS };
