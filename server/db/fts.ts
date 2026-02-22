import type Database from "better-sqlite3";

export function setupFTS(sqlite: Database.Database) {
  // Create FTS5 external content table
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      title,
      content,
      content=items,
      content_rowid=rowid
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
}
