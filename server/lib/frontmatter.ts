/**
 * Extract sparkle_id from YAML frontmatter in a markdown file.
 * Returns null if no valid frontmatter or sparkle_id found.
 */
export function extractSparkleId(content: string): string | null {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch?.[1]) return null;
  const idMatch = fmMatch[1].match(/^sparkle_id:\s*"?([^"\r\n]+)"?/m);
  return idMatch?.[1]?.trim() ?? null;
}
