import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  getSetting,
  getSettings,
  getObsidianSettings,
  updateSettings,
} from "../settings.js";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");

  sqlite.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    INSERT INTO settings (key, value) VALUES
      ('obsidian_enabled', 'false'),
      ('obsidian_vault_path', ''),
      ('obsidian_inbox_folder', '0_Inbox'),
      ('obsidian_export_mode', 'overwrite');
  `);

  return sqlite;
}

describe("Settings", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = createTestDb();
  });

  // ============================================================
  // getSetting
  // ============================================================
  describe("getSetting", () => {
    it("returns value for existing key", () => {
      expect(getSetting(sqlite, "obsidian_enabled")).toBe("false");
    });

    it("returns value for obsidian_inbox_folder", () => {
      expect(getSetting(sqlite, "obsidian_inbox_folder")).toBe("0_Inbox");
    });

    it("returns null for non-existent key", () => {
      expect(getSetting(sqlite, "nonexistent_key")).toBeNull();
    });
  });

  // ============================================================
  // getSettings
  // ============================================================
  describe("getSettings", () => {
    it("returns all default settings", () => {
      const settings = getSettings(sqlite);
      expect(settings).toEqual({
        obsidian_enabled: "false",
        obsidian_vault_path: "",
        obsidian_inbox_folder: "0_Inbox",
        obsidian_export_mode: "overwrite",
      });
    });

    it("returns updated values after update", () => {
      updateSettings(sqlite, { obsidian_vault_path: "/tmp/vault" });
      const settings = getSettings(sqlite);
      expect(settings.obsidian_vault_path).toBe("/tmp/vault");
    });
  });

  // ============================================================
  // getObsidianSettings
  // ============================================================
  describe("getObsidianSettings", () => {
    it("returns typed object with boolean conversion", () => {
      const settings = getObsidianSettings(sqlite);
      expect(settings).toEqual({
        obsidian_enabled: false,
        obsidian_vault_path: "",
        obsidian_inbox_folder: "0_Inbox",
        obsidian_export_mode: "overwrite",
      });
    });

    it("converts obsidian_enabled 'true' to boolean true", () => {
      updateSettings(sqlite, { obsidian_enabled: "true" });
      const settings = getObsidianSettings(sqlite);
      expect(settings.obsidian_enabled).toBe(true);
    });

    it("converts obsidian_enabled 'false' to boolean false", () => {
      const settings = getObsidianSettings(sqlite);
      expect(settings.obsidian_enabled).toBe(false);
    });

    it("reflects updated vault path", () => {
      updateSettings(sqlite, { obsidian_vault_path: "/home/user/vault" });
      const settings = getObsidianSettings(sqlite);
      expect(settings.obsidian_vault_path).toBe("/home/user/vault");
    });
  });

  // ============================================================
  // updateSettings
  // ============================================================
  describe("updateSettings", () => {
    it("updates a single existing key", () => {
      updateSettings(sqlite, { obsidian_enabled: "true" });
      expect(getSetting(sqlite, "obsidian_enabled")).toBe("true");
    });

    it("updates multiple keys at once", () => {
      updateSettings(sqlite, {
        obsidian_enabled: "true",
        obsidian_vault_path: "/tmp/vault",
        obsidian_export_mode: "new",
      });
      expect(getSetting(sqlite, "obsidian_enabled")).toBe("true");
      expect(getSetting(sqlite, "obsidian_vault_path")).toBe("/tmp/vault");
      expect(getSetting(sqlite, "obsidian_export_mode")).toBe("new");
    });

    it("does not affect unmodified keys", () => {
      updateSettings(sqlite, { obsidian_enabled: "true" });
      expect(getSetting(sqlite, "obsidian_inbox_folder")).toBe("0_Inbox");
      expect(getSetting(sqlite, "obsidian_export_mode")).toBe("overwrite");
    });

    it("upserts new keys", () => {
      updateSettings(sqlite, { custom_key: "custom_value" });
      expect(getSetting(sqlite, "custom_key")).toBe("custom_value");
    });

    it("overwrites existing values", () => {
      updateSettings(sqlite, { obsidian_vault_path: "/first" });
      updateSettings(sqlite, { obsidian_vault_path: "/second" });
      expect(getSetting(sqlite, "obsidian_vault_path")).toBe("/second");
    });
  });
});
