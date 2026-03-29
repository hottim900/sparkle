import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";

describe("migration 18→19", () => {
  function createV18Database(opts?: { hasDailyNoteEnabled?: boolean }) {
    const sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    sqlite.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (18);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO settings (key, value) VALUES
        ('obsidian_enabled', 'true'),
        ('obsidian_vault_path', '/tmp/vault'),
        ('daily_note_time', '23:00'),
        ('daily_note_mode', 'subfolder'),
        ('line_brief_enabled', 'true');
    `);

    if (opts?.hasDailyNoteEnabled) {
      sqlite.exec("INSERT INTO settings (key, value) VALUES ('daily_note_enabled', 'false')");
    }

    return sqlite;
  }

  function runMigration18to19(sqlite: Database.Database) {
    sqlite.exec(
      "INSERT OR IGNORE INTO settings (key, value) VALUES ('daily_note_enabled', 'true')",
    );
    sqlite.prepare("UPDATE schema_version SET version = ?").run(19);
  }

  it("seeds daily_note_enabled for databases missing the key", () => {
    const sqlite = createV18Database();
    runMigration18to19(sqlite);

    const row = sqlite
      .prepare("SELECT value FROM settings WHERE key = 'daily_note_enabled'")
      .get() as { value: string };
    expect(row.value).toBe("true");

    const version = sqlite.prepare("SELECT version FROM schema_version").get() as {
      version: number;
    };
    expect(version.version).toBe(19);
  });

  it("does not overwrite existing daily_note_enabled value", () => {
    const sqlite = createV18Database({ hasDailyNoteEnabled: true });
    runMigration18to19(sqlite);

    const row = sqlite
      .prepare("SELECT value FROM settings WHERE key = 'daily_note_enabled'")
      .get() as { value: string };
    expect(row.value).toBe("false");
  });

  it("is idempotent", () => {
    const sqlite = createV18Database();
    runMigration18to19(sqlite);
    runMigration18to19(sqlite);

    const rows = sqlite
      .prepare("SELECT value FROM settings WHERE key = 'daily_note_enabled'")
      .all() as { value: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toBe("true");
  });
});
