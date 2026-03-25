import type Database from "better-sqlite3";
import { toLocalDateStr } from "./stats.js";
import {
  getObsidianSettings,
  getDailyNoteSettings,
  getSetting,
  updateSettings,
} from "./settings.js";
import { generateDailyNote } from "./daily-note.js";
import { logger } from "./logger.js";

let generating = false;

/**
 * Check if now matches the configured daily_note_time (HH:MM).
 * Called every 60s by setInterval.
 */
export function checkAndGenerateDailyNote(sqlite: Database.Database): void {
  if (generating) return;

  const obsidian = getObsidianSettings(sqlite);
  if (!obsidian.obsidian_enabled || !obsidian.obsidian_vault_path) {
    return;
  }

  const settings = getDailyNoteSettings(sqlite);
  const now = new Date();
  const currentHHMM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  if (currentHHMM < settings.daily_note_time) {
    return;
  }

  // Check if already generated today
  const today = toLocalDateStr(now);
  const lastGenerated = getSetting(sqlite, "last_daily_note_date");
  if (lastGenerated === today) {
    return;
  }

  // Mark as processing before async work to prevent double-fire
  generating = true;

  generateDailyNote(sqlite, today)
    .then((result) => {
      updateSettings(sqlite, { last_daily_note_date: today });
      if (!result.skipped) {
        logger.info({ date: today, path: result.path }, "Scheduled daily note generated");
      } else {
        logger.info({ date: today, reason: result.reason }, "Scheduled daily note skipped");
      }
    })
    .catch((err) => {
      logger.error({ err, date: today }, "Scheduled daily note generation failed");
    })
    .finally(() => {
      generating = false;
    });
}
