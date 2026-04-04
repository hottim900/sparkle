import type Database from "better-sqlite3";

export function setupFTS(sqlite: Database.Database) {
  // Check if existing FTS table uses trigram tokenizer; rebuild if not
  const ftsExists = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='items_fts'")
    .get() as { sql: string } | undefined;

  if (ftsExists && !ftsExists.sql.includes("trigram")) {
    sqlite.exec("DROP TABLE IF EXISTS items_fts");
  }

  // Create FTS5 external content table with trigram tokenizer for CJK support
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      title,
      content,
      content=items,
      content_rowid=rowid,
      tokenize='trigram'
    );
  `);

  // Sync triggers: keep FTS5 in sync with items table
  // We use IF NOT EXISTS by checking if trigger already exists
  const triggers = [
    {
      name: "items_ai",
      sql: `
        CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
          INSERT INTO items_fts(rowid, title, content)
          VALUES (new.rowid, new.title, new.content);
        END;
      `,
    },
    {
      name: "items_ad",
      sql: `
        CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
          INSERT INTO items_fts(items_fts, rowid, title, content)
          VALUES ('delete', old.rowid, old.title, old.content);
        END;
      `,
    },
    {
      name: "items_au",
      sql: `
        CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
          INSERT INTO items_fts(items_fts, rowid, title, content)
          VALUES ('delete', old.rowid, old.title, old.content);
          INSERT INTO items_fts(rowid, title, content)
          VALUES (new.rowid, new.title, new.content);
        END;
      `,
    },
  ];

  for (const trigger of triggers) {
    sqlite.exec(trigger.sql);
  }

  // Rebuild FTS index from existing data
  sqlite.exec("INSERT INTO items_fts(items_fts) VALUES ('rebuild')");
}

export function setupVaultFTS(sqlite: Database.Database) {
  // Only set up if vault_files table exists (created by migration v21+)
  const tableExists = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vault_files'")
    .get();
  if (!tableExists) return;

  // Create FTS5 external content table for vault files
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vault_files_fts USING fts5(
      title,
      content,
      content=vault_files,
      content_rowid=rowid,
      tokenize='trigram'
    );
  `);

  // Sync triggers
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS vault_files_ai AFTER INSERT ON vault_files BEGIN
      INSERT INTO vault_files_fts(rowid, title, content)
      VALUES (new.rowid, new.title, new.content);
    END;
  `);
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS vault_files_ad AFTER DELETE ON vault_files BEGIN
      INSERT INTO vault_files_fts(vault_files_fts, rowid, title, content)
      VALUES ('delete', old.rowid, old.title, old.content);
    END;
  `);
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS vault_files_au AFTER UPDATE ON vault_files BEGIN
      INSERT INTO vault_files_fts(vault_files_fts, rowid, title, content)
      VALUES ('delete', old.rowid, old.title, old.content);
      INSERT INTO vault_files_fts(rowid, title, content)
      VALUES (new.rowid, new.title, new.content);
    END;
  `);

  // Rebuild FTS index from existing data
  sqlite.exec("INSERT INTO vault_files_fts(vault_files_fts) VALUES ('rebuild')");
}
