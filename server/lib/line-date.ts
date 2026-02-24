import { zh } from "chrono-node";

export interface DateParseResult {
  success: boolean;
  date: string | null; // YYYY-MM-DD or null
  clear: boolean; // true when user wants to clear due date
}

const CLEAR_KEYWORDS = ["清除", "none", "clear"];

// Taiwan → Cantonese mappings for chrono zh.hant compatibility
const TW_REPLACEMENTS: [RegExp, string][] = [
  [/大後天/g, "大後日"],
  [/後天/g, "後日"],
  [/大前天/g, "大前日"],
  [/前天/g, "前日"],
  [/今天/g, "今日"],
  [/明天/g, "明日"],
  [/昨天/g, "昨日"],
];

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDate(input: string, refDate?: Date): DateParseResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { success: false, date: null, clear: false };
  }

  // 1. Check clear keywords
  if (CLEAR_KEYWORDS.includes(trimmed.toLowerCase())) {
    return { success: true, date: null, clear: true };
  }

  const ref = refDate || new Date();

  // 2. Taiwan → Cantonese replacement
  let converted = trimmed;
  for (const [pattern, replacement] of TW_REPLACEMENTS) {
    converted = converted.replace(pattern, replacement);
  }

  // 3. Try chrono
  const chronoResult = zh.hant.parseDate(converted, ref);
  if (chronoResult) {
    return { success: true, date: toDateString(chronoResult), clear: false };
  }

  // 4. Try YYYY-MM-DD regex
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return { success: true, date: trimmed, clear: false };
  }

  // 5. Try M/D format
  const mdMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (mdMatch) {
    const month = mdMatch[1].padStart(2, "0");
    const day = mdMatch[2].padStart(2, "0");
    const year = ref.getFullYear();
    return { success: true, date: `${year}-${month}-${day}`, clear: false };
  }

  return { success: false, date: null, clear: false };
}
