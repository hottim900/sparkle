/** Extract title from content: first non-empty line, max 80 code points */
export function deriveTitleFromContent(content: string): string {
  const lines = content.split("\n");
  const firstNonEmpty = lines.find((line) => line.trim() !== "") ?? "";
  const trimmed = firstNonEmpty.trim();
  const chars = [...trimmed];
  return chars.length > 80 ? chars.slice(0, 80).join("") + "..." : trimmed;
}
