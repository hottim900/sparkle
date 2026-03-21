import type Database from "better-sqlite3";
import type { ExportMode } from "./export.js";

export interface ObsidianSettings {
  obsidian_enabled: boolean;
  obsidian_vault_path: string;
  obsidian_inbox_folder: string;
  obsidian_export_mode: ExportMode;
}

/**
 * Get a single setting value by key.
 */
export function getSetting(sqlite: Database.Database, key: string): string | null {
  const row = sqlite.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

/**
 * Get all settings as a key-value object.
 */
export function getSettings(sqlite: Database.Database): Record<string, string> {
  const rows = sqlite.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

/**
 * Get Obsidian-specific settings with typed conversions.
 */
export function getObsidianSettings(sqlite: Database.Database): ObsidianSettings {
  const all = getSettings(sqlite);
  return {
    obsidian_enabled: all.obsidian_enabled === "true",
    obsidian_vault_path: all.obsidian_vault_path ?? "",
    obsidian_inbox_folder: all.obsidian_inbox_folder ?? "0_Inbox",
    obsidian_export_mode: (all.obsidian_export_mode ?? "overwrite") as ExportMode,
  };
}

export interface DashboardSettings {
  recentDays: number;
  staleDays: number;
}

/**
 * Get dashboard-specific settings with typed conversions.
 */
export function getDashboardSettings(sqlite: Database.Database): DashboardSettings {
  const all = getSettings(sqlite);
  return {
    recentDays: parseInt(all.recent_days ?? "7", 10) || 7,
    staleDays: parseInt(all.stale_days ?? "14", 10) || 14,
  };
}

/**
 * Update one or more settings. Uses upsert (INSERT OR REPLACE).
 */
export function updateSettings(sqlite: Database.Database, updates: Record<string, string>): void {
  const stmt = sqlite.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  const runAll = sqlite.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      stmt.run(key, value);
    }
  });
  runAll();
}
