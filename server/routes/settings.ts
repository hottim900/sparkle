import { Hono } from "hono";
import { z, ZodError } from "zod";
import { accessSync, constants } from "node:fs";
import { sqlite } from "../db/index.js";
import { getSettings, updateSettings } from "../lib/settings.js";

const settingsRouter = new Hono();

const ALLOWED_KEYS = [
  "obsidian_enabled",
  "obsidian_vault_path",
  "obsidian_inbox_folder",
  "obsidian_export_mode",
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
        return c.json({ error: `Vault path is not writable: ${vaultPath}` }, 400);
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
