import type Database from "better-sqlite3";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { toLocalDateStr } from "./stats.js";
import { getObsidianSettings, getDailyNoteSettings } from "./settings.js";
import { logger } from "./logger.js";

// --- Types ---

interface DayTodo {
  id: string;
  title: string;
  priority: string | null;
  due: string | null;
}

interface DayNote {
  id: string;
  title: string;
  status: string;
  origin: string | null;
}

interface DayData {
  date: string;
  todos_due: DayTodo[];
  notes_created: DayNote[];
  notes_modified: DayNote[];
  overdue: DayTodo[];
  origins: string[];
}

export interface GenerateResult {
  date: string;
  path: string;
  skipped?: boolean;
  reason?: string;
}

// --- Helpers ---

/** Get UTC ISO string for the start of a local day. */
function getLocalDayBoundary(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toISOString();
}

/** Make a short ID (first 7 chars) for inline code markers. */
function shortId(id: string): string {
  return id.slice(0, 7);
}

/** Escape characters that break wikilink syntax: | ]] [[ and newlines. */
function safeTitle(title: string): string {
  return title
    .replace(/\|/g, "-")
    .replace(/\]\]/g, "）")
    .replace(/\[\[/g, "（")
    .replace(/\n/g, " ");
}

/** Get day-of-week name in Chinese. */
function dayOfWeekChinese(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y!, m! - 1, d!);
  const names = ["日", "一", "二", "三", "四", "五", "六"];
  return names[date.getDay()]!;
}

/** Validate that a resolved path is within the vault (prevent path traversal). */
function validatePathWithinVault(vaultPath: string, targetPath: string): void {
  const resolvedVault = resolve(vaultPath);
  const resolvedTarget = resolve(targetPath);
  if (!resolvedTarget.startsWith(resolvedVault + "/") && resolvedTarget !== resolvedVault) {
    throw new Error(`Path traversal detected: ${targetPath} is outside vault ${vaultPath}`);
  }
}

// --- Query ---

function queryDayData(sqlite: Database.Database, dateStr: string): DayData {
  const [y, m, d] = dateStr.split("-").map(Number);
  const nextDate = toLocalDateStr(new Date(y!, m! - 1, d! + 1));

  const rangeStart = getLocalDayBoundary(dateStr);
  const rangeEnd = getLocalDayBoundary(nextDate);

  // Todos due on this date (exclude done/archived — only actionable todos)
  const todosDue = sqlite
    .prepare(
      `SELECT id, title, priority, due
       FROM items
       WHERE type = 'todo'
         AND status NOT IN ('done', 'exported', 'archived')
         AND due = ?
         AND is_private = 0`,
    )
    .all(dateStr) as DayTodo[];

  // Notes created on this date
  const notesCreated = sqlite
    .prepare(
      `SELECT id, title, status, origin
       FROM items
       WHERE type = 'note'
         AND created >= ? AND created < ?
         AND status != 'archived'
         AND is_private = 0`,
    )
    .all(rangeStart, rangeEnd) as DayNote[];

  // Notes modified on this date (dedup: exclude same-day created)
  const createdIds = new Set(notesCreated.map((n) => n.id));
  const notesModifiedRaw = sqlite
    .prepare(
      `SELECT id, title, status, origin
       FROM items
       WHERE type = 'note'
         AND modified >= ? AND modified < ?
         AND status != 'archived'
         AND is_private = 0`,
    )
    .all(rangeStart, rangeEnd) as DayNote[];
  const notesModified = notesModifiedRaw.filter((n) => !createdIds.has(n.id));

  // Overdue todos (due before this date, still active)
  const overdue = sqlite
    .prepare(
      `SELECT id, title, priority, due
       FROM items
       WHERE type = 'todo'
         AND status NOT IN ('done', 'exported', 'archived')
         AND due IS NOT NULL
         AND due < ?
         AND is_private = 0`,
    )
    .all(dateStr) as DayTodo[];

  // Collect unique origins
  const originSet = new Set<string>();
  for (const note of [...notesCreated, ...notesModified]) {
    if (note.origin) originSet.add(note.origin);
  }

  return {
    date: dateStr,
    todos_due: todosDue,
    notes_created: notesCreated,
    notes_modified: notesModified,
    overdue,
    origins: [...originSet],
  };
}

// --- Markdown generation ---

function generateDailyNoteMarkdown(data: DayData): string {
  const { date, todos_due, notes_created, notes_modified, overdue, origins } = data;
  const dow = dayOfWeekChinese(date);

  // Frontmatter
  const fm: string[] = ["---"];
  fm.push(`sparkle_date: ${date}`);
  fm.push(`sparkle_notes_created: ${notes_created.length}`);
  fm.push(`sparkle_notes_modified: ${notes_modified.length}`);
  fm.push(`sparkle_todos_due: ${todos_due.length}`);
  fm.push(`sparkle_overdue: ${overdue.length}`);
  if (origins.length > 0) {
    const safeOrigins = origins.map((o) => `"${o.replace(/[\\"\n\r]/g, "")}"`);
    fm.push(`sparkle_origins: [${safeOrigins.join(", ")}]`);
  }
  fm.push("tags: [sparkle/daily]");
  fm.push("---");

  const lines: string[] = [fm.join("\n"), ""];
  lines.push(`# ${date} (${dow})`);

  // 捕捉 (newly created notes)
  if (notes_created.length > 0) {
    lines.push("", "## 捕捉");
    for (const note of notes_created) {
      const title = safeTitle(note.title);
      const originTag = note.origin ? `, via ${note.origin}` : "";
      lines.push(`- [[${title}|sparkle-${shortId(note.id)}]] (${note.status}${originTag})`);
    }
  }

  // 活躍筆記 (modified notes)
  if (notes_modified.length > 0) {
    lines.push("", "## 活躍筆記");
    for (const note of notes_modified) {
      const title = safeTitle(note.title);
      lines.push(`- [[${title}|sparkle-${shortId(note.id)}]] (${note.status}, 今日修改)`);
    }
  }

  // 待辦
  if (todos_due.length > 0) {
    lines.push("", "## 待辦");
    for (const todo of todos_due) {
      const priorityTag = todo.priority ? ` (${todo.priority.toUpperCase()})` : "";
      lines.push(
        `- [ ] ${todo.title.replace(/\n/g, " ")}${priorityTag} \`sparkle:${shortId(todo.id)}\``,
      );
    }
  }

  // 逾期
  if (overdue.length > 0) {
    lines.push("", "## 逾期");
    for (const todo of overdue) {
      const dueTag = todo.due ? ` (due: ${todo.due})` : "";
      lines.push(
        `- [ ] ${todo.title.replace(/\n/g, " ")}${dueTag} \`sparkle:${shortId(todo.id)}\``,
      );
    }
  }

  lines.push("");
  return lines.join("\n");
}

function generateAppendSection(data: DayData): string {
  const { date, notes_created, notes_modified, todos_due, overdue } = data;
  const lines: string[] = [];

  lines.push(`<!-- sparkle:${date} -->`);
  lines.push("## Sparkle 活動");
  lines.push("");

  if (notes_created.length > 0) {
    lines.push("### 捕捉");
    for (const note of notes_created) {
      const title = safeTitle(note.title);
      const originTag = note.origin ? `, via ${note.origin}` : "";
      lines.push(`- [[${title}|sparkle-${shortId(note.id)}]] (${note.status}${originTag})`);
    }
    lines.push("");
  }

  if (notes_modified.length > 0) {
    lines.push("### 活躍筆記");
    for (const note of notes_modified) {
      const title = safeTitle(note.title);
      lines.push(`- [[${title}|sparkle-${shortId(note.id)}]] (${note.status}, 今日修改)`);
    }
    lines.push("");
  }

  if (todos_due.length > 0) {
    lines.push("### 待辦");
    for (const todo of todos_due) {
      const priorityTag = todo.priority ? ` (${todo.priority.toUpperCase()})` : "";
      lines.push(
        `- [ ] ${todo.title.replace(/\n/g, " ")}${priorityTag} \`sparkle:${shortId(todo.id)}\``,
      );
    }
    lines.push("");
  }

  if (overdue.length > 0) {
    lines.push("### 逾期");
    for (const todo of overdue) {
      const dueTag = todo.due ? ` (due: ${todo.due})` : "";
      lines.push(
        `- [ ] ${todo.title.replace(/\n/g, " ")}${dueTag} \`sparkle:${shortId(todo.id)}\``,
      );
    }
    lines.push("");
  }

  lines.push("<!-- /sparkle -->");
  return lines.join("\n");
}

// --- File operations ---

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeSubfolderMode(
  vaultPath: string,
  dailyFolder: string,
  dateStr: string,
  content: string,
): Promise<string> {
  const targetDir = join(vaultPath, dailyFolder, "Sparkle");
  validatePathWithinVault(vaultPath, targetDir);
  await mkdir(targetDir, { recursive: true });

  const filename = `${dateStr}.md`;
  const filePath = join(targetDir, filename);
  await writeFile(filePath, content, "utf-8");

  return `${dailyFolder}/Sparkle/${filename}`;
}

async function writeAppendMode(
  vaultPath: string,
  dailyFolder: string,
  dateStr: string,
  appendContent: string,
): Promise<string> {
  const targetDir = join(vaultPath, dailyFolder);
  validatePathWithinVault(vaultPath, targetDir);
  await mkdir(targetDir, { recursive: true });

  const filename = `${dateStr}.md`;
  const filePath = join(targetDir, filename);

  if (await fileExists(filePath)) {
    const existing = await readFile(filePath, "utf-8");

    // Check for existing sparkle section
    const openMarker = `<!-- sparkle:${dateStr} -->`;
    const closeMarker = "<!-- /sparkle -->";
    const openIdx = existing.indexOf(openMarker);

    if (openIdx >= 0) {
      // Prefer closing marker for precise boundary; fall back to next ## heading
      const closeIdx = existing.indexOf(closeMarker, openIdx);
      let endIdx: number;
      if (closeIdx >= 0) {
        endIdx = closeIdx + closeMarker.length;
      } else {
        const afterOpen = existing.slice(openIdx + 1);
        const nextH2 = afterOpen.search(/\n## (?!Sparkle 活動)/);
        endIdx = nextH2 >= 0 ? openIdx + 1 + nextH2 : existing.length;
      }

      const before = existing.slice(0, openIdx);
      const after = existing.slice(endIdx);
      await writeFile(filePath, before + appendContent + after, "utf-8");
    } else {
      // Append to end
      const separator = existing.endsWith("\n") ? "\n" : "\n\n";
      await writeFile(filePath, existing + separator + appendContent, "utf-8");
    }
  } else {
    // Create new file with just the sparkle section
    await writeFile(filePath, appendContent, "utf-8");
  }

  return `${dailyFolder}/${filename}`;
}

// --- Public API ---

export async function generateDailyNote(
  sqlite: Database.Database,
  dateStr?: string,
): Promise<GenerateResult> {
  // Default to today
  const targetDate = dateStr || toLocalDateStr(new Date());

  // Validate date format and actual calendar date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    throw new Error(`Invalid date format: ${targetDate}. Expected YYYY-MM-DD.`);
  }
  const [vy, vm, vd] = targetDate.split("-").map(Number);
  const parsed = new Date(vy!, vm! - 1, vd!);
  if (toLocalDateStr(parsed) !== targetDate) {
    throw new Error(`Invalid date: ${targetDate} is not a real calendar date.`);
  }

  // Check Obsidian settings
  const obsidian = getObsidianSettings(sqlite);
  if (!obsidian.obsidian_enabled) {
    return {
      date: targetDate,
      path: "",
      skipped: true,
      reason: "Obsidian integration is disabled",
    };
  }
  if (!obsidian.obsidian_vault_path) {
    return { date: targetDate, path: "", skipped: true, reason: "Obsidian vault path is not set" };
  }

  const dailySettings = getDailyNoteSettings(sqlite);
  const vaultPath = obsidian.obsidian_vault_path;
  const dailyFolder = dailySettings.obsidian_daily_folder;
  const mode = dailySettings.daily_note_mode;

  // Query day data
  const data = queryDayData(sqlite, targetDate);

  // Skip empty days
  const hasActivity =
    data.todos_due.length > 0 ||
    data.notes_created.length > 0 ||
    data.notes_modified.length > 0 ||
    data.overdue.length > 0;

  if (!hasActivity) {
    return { date: targetDate, path: "", skipped: true, reason: "No activity for this date" };
  }

  // Generate and write
  let relativePath: string;
  if (mode === "append") {
    const appendContent = generateAppendSection(data);
    relativePath = await writeAppendMode(vaultPath, dailyFolder, targetDate, appendContent);
  } else {
    const markdown = generateDailyNoteMarkdown(data);
    relativePath = await writeSubfolderMode(vaultPath, dailyFolder, targetDate, markdown);
  }

  logger.info({ date: targetDate, path: relativePath, mode }, "Daily note generated");
  return { date: targetDate, path: relativePath };
}
