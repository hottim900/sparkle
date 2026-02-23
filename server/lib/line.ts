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
