import { Hono } from "hono";
import { sqlite } from "../db/index.js";
import { generateAndPushBrief } from "../lib/line-brief.js";
import { updateSettings } from "../lib/settings.js";
import { toLocalDateStr } from "../lib/stats.js";
import { logger } from "../lib/logger.js";

const lineBriefRouter = new Hono();

// POST /api/line-brief/send?date=YYYY-MM-DD
lineBriefRouter.post("/send", async (c) => {
  const dateParam = c.req.query("date");

  // Validate date format and components if provided
  if (dateParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return c.json({ error: "Invalid date format. Expected YYYY-MM-DD." }, 400);
    }
    const [y, m, d] = dateParam.split("-").map(Number);
    const parsed = new Date(y!, m! - 1, d!);
    if (isNaN(parsed.getTime()) || parsed.getMonth() !== m! - 1 || parsed.getDate() !== d!) {
      return c.json({ error: "Invalid date. Month must be 1-12, day must be valid." }, 400);
    }
  }

  try {
    const result = await generateAndPushBrief(sqlite, dateParam);

    // Update dedup state when sending for today (prevents scheduler from re-sending)
    const today = toLocalDateStr(new Date());
    if (result.sent && (!dateParam || dateParam === today)) {
      updateSettings(sqlite, { last_brief_sent_date: today });
    }

    return c.json(result);
  } catch (err) {
    logger.error({ err, date: dateParam }, "Failed to send LINE brief");
    return c.json({ error: "Failed to send LINE brief" }, 500);
  }
});

export { lineBriefRouter };
