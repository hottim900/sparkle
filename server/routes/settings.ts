import { Hono } from "hono";
import { z, ZodError } from "zod";
import { accessSync, constants } from "node:fs";
import { sqlite } from "../db/index.js";
import { getSettings, updateSettings } from "../lib/settings.js";

const settingsRouter = new Hono();

/**
 * Whitelist of settings keys that can be updated through the public API.
 *
 * Internal-only keys are intentionally excluded (not a bug):
 * - `last_daily_note_date` — written by the daily note scheduler to track dedup state
 * - `last_brief_sent_date` — written by the LINE brief scheduler to track dedup state
 *
 * These scheduler dedup keys must not be user-editable to prevent skipping or
 * double-triggering scheduled jobs.
 */
const ALLOWED_KEYS = [
  "obsidian_enabled",
  "obsidian_vault_path",
  "obsidian_inbox_folder",
  "obsidian_export_mode",
  "obsidian_daily_folder",
  "daily_note_time",
  "daily_note_enabled",
  "daily_note_mode",
  "recent_days",
  "stale_days",
  "line_brief_enabled",
  "line_brief_time",
] as const;

const updateSettingsSchema = z
  .record(z.string(), z.string())
  .refine((obj) => Object.keys(obj).every((k) => (ALLOWED_KEYS as readonly string[]).includes(k)), {
    message: "Unknown settings key",
  })
  .refine(
    (obj) => {
      if (
        "obsidian_enabled" in obj &&
        obj.obsidian_enabled !== "true" &&
        obj.obsidian_enabled !== "false"
      ) {
        return false;
      }
      return true;
    },
    { message: 'obsidian_enabled must be "true" or "false"' },
  )
  .refine(
    (obj) => {
      if (
        "obsidian_export_mode" in obj &&
        obj.obsidian_export_mode !== "overwrite" &&
        obj.obsidian_export_mode !== "new"
      ) {
        return false;
      }
      return true;
    },
    { message: 'obsidian_export_mode must be "overwrite" or "new"' },
  )
  .refine(
    (obj) => {
      if (
        "daily_note_enabled" in obj &&
        obj.daily_note_enabled !== "true" &&
        obj.daily_note_enabled !== "false"
      ) {
        return false;
      }
      return true;
    },
    { message: 'daily_note_enabled must be "true" or "false"' },
  )
  .refine(
    (obj) => {
      if (
        "daily_note_mode" in obj &&
        obj.daily_note_mode !== "subfolder" &&
        obj.daily_note_mode !== "append"
      ) {
        return false;
      }
      return true;
    },
    { message: 'daily_note_mode must be "subfolder" or "append"' },
  )
  .refine(
    (obj) => {
      if ("daily_note_time" in obj) {
        return /^([01]\d|2[0-3]):[0-5]\d$/.test(obj.daily_note_time ?? "");
      }
      return true;
    },
    { message: "daily_note_time must be in HH:MM format" },
  )
  .refine(
    (obj) => {
      if (
        "line_brief_enabled" in obj &&
        obj.line_brief_enabled !== "true" &&
        obj.line_brief_enabled !== "false"
      ) {
        return false;
      }
      return true;
    },
    { message: 'line_brief_enabled must be "true" or "false"' },
  )
  .refine(
    (obj) => {
      if ("line_brief_time" in obj) {
        return /^([01]\d|2[0-3]):[0-5]\d$/.test(obj.line_brief_time ?? "");
      }
      return true;
    },
    { message: "line_brief_time must be in HH:MM format" },
  )
  .refine(
    (obj) => {
      if ("obsidian_daily_folder" in obj) {
        const v = obj.obsidian_daily_folder ?? "";
        if (v.includes("..") || v.startsWith("/") || v.includes("\0") || v.length > 255) {
          return false;
        }
      }
      return true;
    },
    { message: "obsidian_daily_folder must be a relative path without '..' (max 255 chars)" },
  )
  .refine(
    (obj) => {
      for (const key of ["recent_days", "stale_days"] as const) {
        if (key in obj) {
          const n = parseInt(obj[key] ?? "", 10);
          if (isNaN(n) || n < 1 || n > 365) return false;
        }
      }
      return true;
    },
    { message: "recent_days and stale_days must be integers between 1 and 365" },
  );

// GET /api/settings — return all settings
settingsRouter.get("/", (c) => {
  const settings = getSettings(sqlite);
  return c.json(settings);
});

// PUT /api/settings — partial update with validation
settingsRouter.put("/", async (c) => {
  try {
    const body = await c.req.json();
    const updates = updateSettingsSchema.parse(body);

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "No settings provided" }, 400);
    }

    // When enabling obsidian, validate vault_path
    const willEnable = updates.obsidian_enabled === "true";
    if (willEnable) {
      // Use provided vault_path or fall back to current DB value
      const vaultPath = updates.obsidian_vault_path ?? getSettings(sqlite).obsidian_vault_path;
      if (!vaultPath) {
        return c.json(
          { error: "obsidian_vault_path must be non-empty when enabling Obsidian" },
          400,
        );
      }
      try {
        accessSync(vaultPath, constants.W_OK);
      } catch {
        return c.json({ error: "Vault path is not accessible or not writable" }, 400);
      }
    }

    updateSettings(sqlite, updates);
    const settings = getSettings(sqlite);
    return c.json(settings);
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

export { settingsRouter };
