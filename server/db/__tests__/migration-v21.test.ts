import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";

describe("migration 20→21", () => {
  function createV20Database() {
    const sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    sqlite.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (20);

      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'note',
        title TEXT NOT NULL,
        content TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'fleeting',
        export_path TEXT DEFAULT NULL,
        created TEXT NOT NULL,
        modified TEXT NOT NULL
      );
    `);

    return sqlite;
  }

  function runMigration20to21(sqlite: Database.Database) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS vault_files (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        frontmatter TEXT,
        content TEXT NOT NULL,
        mtime INTEGER NOT NULL,
        content_hash TEXT NOT NULL
      )
    `);
    sqlite.prepare("UPDATE schema_version SET version = ?").run(21);
  }

  it("creates vault_files table", () => {
    const sqlite = createV20Database();
    runMigration20to21(sqlite);

    const table = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vault_files'")
      .get() as { name: string } | undefined;
    expect(table?.name).toBe("vault_files");
  });

  it("vault_files has correct columns", () => {
    const sqlite = createV20Database();
    runMigration20to21(sqlite);

    // Insert a row to verify schema
    sqlite.exec(`
      INSERT INTO vault_files (path, title, frontmatter, content, mtime, content_hash)
      VALUES ('0_Inbox/Test.md', 'Test', '{"tags":[]}', 'Hello world', 1700000000, 'abc123')
    `);

    const row = sqlite
      .prepare("SELECT * FROM vault_files WHERE path = '0_Inbox/Test.md'")
      .get() as {
      path: string;
      title: string;
      frontmatter: string;
      content: string;
      mtime: number;
      content_hash: string;
    };
    expect(row.path).toBe("0_Inbox/Test.md");
    expect(row.title).toBe("Test");
    expect(row.frontmatter).toBe('{"tags":[]}');
    expect(row.content).toBe("Hello world");
    expect(row.mtime).toBe(1700000000);
    expect(row.content_hash).toBe("abc123");
  });

  it("frontmatter is nullable", () => {
    const sqlite = createV20Database();
    runMigration20to21(sqlite);

    sqlite.exec(`
      INSERT INTO vault_files (path, title, content, mtime, content_hash)
      VALUES ('notes/no-fm.md', 'No FM', 'Content', 1700000000, 'def456')
    `);

    const row = sqlite
      .prepare("SELECT frontmatter FROM vault_files WHERE path = 'notes/no-fm.md'")
      .get() as { frontmatter: string | null };
    expect(row.frontmatter).toBeNull();
  });

  it("is idempotent (running twice is safe)", () => {
    const sqlite = createV20Database();
    runMigration20to21(sqlite);
    runMigration20to21(sqlite);

    const version = sqlite.prepare("SELECT version FROM schema_version").get() as {
      version: number;
    };
    expect(version.version).toBe(21);
  });

  it("path is unique (PRIMARY KEY)", () => {
    const sqlite = createV20Database();
    runMigration20to21(sqlite);

    sqlite.exec(`
      INSERT INTO vault_files (path, title, content, mtime, content_hash)
      VALUES ('test.md', 'First', 'Content 1', 1700000000, 'hash1')
    `);

    expect(() =>
      sqlite.exec(`
        INSERT INTO vault_files (path, title, content, mtime, content_hash)
        VALUES ('test.md', 'Duplicate', 'Content 2', 1700000001, 'hash2')
      `),
    ).toThrow();
  });
});
