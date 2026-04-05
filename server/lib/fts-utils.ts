/**
 * Escape user input for FTS5 MATCH. Each token is wrapped in double-quotes
 * (phrase literal) to prevent FTS5 syntax characters from being interpreted.
 * Multiple tokens are AND-joined so all must match.
 * Embedded double-quotes are doubled per FTS5 syntax.
 */
export function escapeFts5Query(raw: string): string {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND ");
}
