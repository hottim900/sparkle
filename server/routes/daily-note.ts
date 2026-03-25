import { Hono } from "hono";
import { sqlite } from "../db/index.js";
import { generateDailyNote } from "../lib/daily-note.js";
import { updateSettings } from "../lib/settings.js";
import { toLocalDateStr } from "../lib/stats.js";
import { logger } from "../lib/logger.js";

const dailyNoteRouter = new Hono();

// POST /api/daily-note/generate?date=YYYY-MM-DD
dailyNoteRouter.post("/generate", async (c) => {
  const dateParam = c.req.query("date");

  // Validate date format if provided
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return c.json({ error: "Invalid date format. Expected YYYY-MM-DD." }, 400);
  }

  try {
    const result = await generateDailyNote(sqlite, dateParam || undefined);

    // Update dedup state when generating for today (prevents scheduler from re-generating)
    const today = toLocalDateStr(new Date());
    if (!result.skipped && result.date === today) {
      updateSettings(sqlite, { last_daily_note_date: today });
    }

    return c.json(result);
  } catch (err) {
    logger.error({ err, date: dateParam }, "Failed to generate daily note");
    return c.json({ error: "Failed to generate daily note" }, 500);
  }
});

export { dailyNoteRouter };
