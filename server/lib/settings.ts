import type Database from "better-sqlite3";

export interface ObsidianSettings {
  obsidian_enabled: boolean;
  obsidian_vault_path: string;
  obsidian_inbox_folder: string;
  obsidian_export_mode: string;
}

/**
 * Get a single setting value by key.
 */
export function getSetting(
  sqlite: Database.Database,
  key: string,
): string | null {
  const row = sqlite
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

/**
 * Get all settings as a key-value object.
 */
export function getSettings(
  sqlite: Database.Database,
): Record<string, string> {
  const rows = sqlite
    .prepare("SELECT key, value FROM settings")
    .all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

/**
 * Get Obsidian-specific settings with typed conversions.
 */
export function getObsidianSettings(
  sqlite: Database.Database,
): ObsidianSettings {
  const all = getSettings(sqlite);
  return {
    obsidian_enabled: all.obsidian_enabled === "true",
    obsidian_vault_path: all.obsidian_vault_path ?? "",
    obsidian_inbox_folder: all.obsidian_inbox_folder ?? "0_Inbox",
    obsidian_export_mode: all.obsidian_export_mode ?? "overwrite",
  };
}

/**
 * Update one or more settings. Uses upsert (INSERT OR REPLACE).
 */
export function updateSettings(
  sqlite: Database.Database,
  updates: Record<string, string>,
): void {
  const stmt = sqlite.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
  );
  const runAll = sqlite.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      stmt.run(key, value);
    }
  });
  runAll();
}
