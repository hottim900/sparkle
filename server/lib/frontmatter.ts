/**
 * Extract the YAML frontmatter block (between `---` fences) as a raw string.
 * Returns null when the document has no closed frontmatter. Strips trailing
 * `\r` from each line so callers store CRLF input as LF.
 */
export function extractFrontmatterBlock(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match?.[1]?.replace(/\r$/gm, "") ?? null;
}

/** Extract `sparkle_id` from the frontmatter block; null if absent. */
export function extractSparkleId(content: string): string | null {
  const block = extractFrontmatterBlock(content);
  if (!block) return null;
  const idMatch = block.match(/^sparkle_id:\s*"?([^"\r\n]+)"?/m);
  return idMatch?.[1]?.trim() ?? null;
}
