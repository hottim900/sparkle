import { Hono } from "hono";
import { sqlite } from "../db/index.js";
import { generateAndPushBrief } from "../lib/line-brief.js";
import { updateSettings } from "../lib/settings.js";
import { toLocalDateStr } from "../lib/stats.js";
import { logger } from "../lib/logger.js";
import { validateDateParam } from "../lib/date-utils.js";

const lineBriefRouter = new Hono();

// POST /api/line-brief/send?date=YYYY-MM-DD
lineBriefRouter.post("/send", async (c) => {
  const dateParam = c.req.query("date");

  // Validate date format and semantic correctness if provided
  if (dateParam) {
    const dateError = validateDateParam(dateParam);
    if (dateError) {
      return c.json({ error: dateError }, 400);
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
