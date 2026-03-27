import type Database from "better-sqlite3";
import { toLocalDateStr } from "./stats.js";
import { getLineBriefSettings, getSetting, updateSettings } from "./settings.js";
import { generateAndPushBrief } from "./line-brief.js";
import { logger } from "./logger.js";

let sending = false;

/**
 * Check if now matches the configured line_brief_time (HH:MM).
 * Called every 60s by setInterval.
 */
export function checkAndSendLineBrief(sqlite: Database.Database): void {
  if (sending) return;

  const settings = getLineBriefSettings(sqlite);
  if (!settings.line_brief_enabled) {
    return;
  }

  // Check LINE Bot env vars are present
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN || !process.env.LINE_ALLOWED_USER_IDS) {
    return;
  }

  const now = new Date();
  const currentHHMM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  if (currentHHMM < settings.line_brief_time) {
    return;
  }

  // Check if already sent today
  const today = toLocalDateStr(now);
  const lastSent = getSetting(sqlite, "last_brief_sent_date");
  if (lastSent === today) {
    return;
  }

  // Mark as processing to prevent double-fire
  sending = true;

  generateAndPushBrief(sqlite, today)
    .then((result) => {
      if (result.sent) {
        // Only record on successful send
        updateSettings(sqlite, { last_brief_sent_date: today });
        logger.info({ date: today }, "Scheduled LINE brief sent");
      } else if (result.skipped) {
        // Skipped (quiet day or config issue) — still mark date to avoid retrying
        updateSettings(sqlite, { last_brief_sent_date: today });
        logger.info({ date: today, reason: result.reason }, "Scheduled LINE brief skipped");
      } else {
        // Failed push — don't mark date so it retries next tick
        logger.error({ date: today, reason: result.reason }, "Scheduled LINE brief failed");
      }
    })
    .catch((err) => {
      logger.error({ err, date: today }, "Scheduled LINE brief error");
    })
    .finally(() => {
      sending = false;
    });
}
