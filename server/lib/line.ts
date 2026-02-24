export interface ParsedLineMessage {
  title: string;
  content: string;
  type: "note" | "todo";
  priority: "high" | null;
  source: string;
}

export function parseLineMessage(
  text: string,
  isForwarded?: boolean,
): ParsedLineMessage {
  const source = isForwarded ? "LINE 轉傳" : "LINE";
  const trimmed = text.trim();

  if (trimmed === "") {
    return { title: "", content: "", type: "note", priority: null, source };
  }

  // Split into first line and remaining content
  const newlineIndex = trimmed.indexOf("\n");
  let firstLine: string;
  let content: string;

  if (newlineIndex === -1) {
    firstLine = trimmed;
    content = "";
  } else {
    firstLine = trimmed.slice(0, newlineIndex).trim();
    content = trimmed.slice(newlineIndex + 1);
  }

  // Parse prefix commands from the first line
  let type: "note" | "todo" = "note";
  let priority: "high" | null = null;
  let remaining = firstLine;

  // Process prefixes iteratively (order-independent)
  let changed = true;
  while (changed) {
    changed = false;

    if (remaining.toLowerCase().startsWith("!todo")) {
      type = "todo";
      remaining = remaining.slice(5).trimStart();
      changed = true;
    }

    if (remaining.toLowerCase().startsWith("!high")) {
      priority = "high";
      remaining = remaining.slice(5).trimStart();
      changed = true;
    }
  }

  return {
    title: remaining.trim(),
    content,
    type,
    priority,
    source,
  };
}

export type LineCommand =
  | { type: "save"; parsed: ParsedLineMessage }
  | { type: "help" }
  | { type: "find"; keyword: string }
  | { type: "inbox" }
  | { type: "today" }
  | { type: "stats" }
  | { type: "active" }
  | { type: "notes" }
  | { type: "todos" }
  | { type: "list"; tag: string }
  | { type: "detail"; index: number }
  | { type: "due"; index: number; dateInput: string }
  | { type: "tag"; index: number; tags: string[] }
  | { type: "done"; index: number }
  | { type: "archive"; index: number }
  | { type: "unknown" };

export function parseCommand(text: string): LineCommand {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // Help commands
  if (lower === "?" || lower === "help" || lower === "說明") {
    return { type: "help" };
  }

  // ! commands
  if (lower.startsWith("!")) {
    // !find <keyword>
    if (lower.startsWith("!find ")) {
      const keyword = trimmed.slice(6).trim();
      return keyword ? { type: "find", keyword } : { type: "unknown" };
    }
    if (lower === "!inbox") return { type: "inbox" };
    if (lower === "!today") return { type: "today" };
    if (lower === "!stats") return { type: "stats" };
    if (lower === "!active") return { type: "active" };
    if (lower === "!notes") return { type: "notes" };
    if (lower === "!todos") return { type: "todos" };

    // !done <N>
    if (lower.startsWith("!done")) {
      const rest = trimmed.slice(5).trim();
      if (!rest) return { type: "unknown" };
      const num = parseInt(rest, 10);
      return !isNaN(num) && num > 0 ? { type: "done", index: num } : { type: "unknown" };
    }

    // !archive <N>
    if (lower.startsWith("!archive")) {
      const rest = trimmed.slice(8).trim();
      if (!rest) return { type: "unknown" };
      const num = parseInt(rest, 10);
      return !isNaN(num) && num > 0 ? { type: "archive", index: num } : { type: "unknown" };
    }

    // !list <tag>
    if (lower.startsWith("!list ")) {
      const tag = trimmed.slice(6).trim();
      return tag ? { type: "list", tag } : { type: "unknown" };
    }

    // !detail <N>
    if (lower.startsWith("!detail ")) {
      const num = parseInt(trimmed.slice(8).trim(), 10);
      return !isNaN(num) && num > 0 ? { type: "detail", index: num } : { type: "unknown" };
    }

    // !due <N> <dateInput>
    if (lower.startsWith("!due ")) {
      const rest = trimmed.slice(5).trim();
      const spaceIdx = rest.indexOf(" ");
      if (spaceIdx === -1) return { type: "unknown" };
      const num = parseInt(rest.slice(0, spaceIdx), 10);
      const dateInput = rest.slice(spaceIdx + 1).trim();
      return !isNaN(num) && num > 0 && dateInput
        ? { type: "due", index: num, dateInput }
        : { type: "unknown" };
    }

    // !tag <N> <tag1> <tag2> ...
    if (lower.startsWith("!tag ")) {
      const rest = trimmed.slice(5).trim();
      const parts = rest.split(/\s+/);
      if (parts.length < 2) return { type: "unknown" };
      const num = parseInt(parts[0], 10);
      if (isNaN(num) || num <= 0) return { type: "unknown" };
      const tags = parts.slice(1);
      return { type: "tag", index: num, tags };
    }

    // !todo / !high → save command (existing behavior)
    if (lower.startsWith("!todo") || lower.startsWith("!high")) {
      return { type: "save", parsed: parseLineMessage(trimmed) };
    }

    return { type: "unknown" };
  }

  // Regular text → save
  const parsed = parseLineMessage(trimmed);
  if (!parsed.title) return { type: "unknown" };
  return { type: "save", parsed };
}
