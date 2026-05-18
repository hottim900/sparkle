import type Database from "better-sqlite3";

export function setupFTS(sqlite: Database.Database) {
  // Check if existing FTS table uses trigram tokenizer; rebuild if not
  const ftsExists = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='items_active_fts'")
    .get() as { sql: string } | undefined;

  if (ftsExists && !ftsExists.sql.includes("trigram")) {
    sqlite.exec("DROP TABLE IF EXISTS items_active_fts");
  }

  // Create FTS5 external content table with trigram tokenizer for CJK support
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS items_active_fts USING fts5(
      title,
      content,
      content=items_active,
      content_rowid=rowid,
      tokenize='trigram'
    );
  `);

  // items_active_au must be narrowed to `AFTER UPDATE OF title, content`. The
  // unqualified `AFTER UPDATE` form (pre-v26) fires on any column change,
  // including the upcoming reindex_dirty flag write — every flip becomes a
  // redundant FTS reindex. Detect the old form via sqlite_master and
  // drop-then-recreate inside a transaction so concurrent writers can't slip
  // an UPDATE between DROP and CREATE (which would silently desync FTS).
  const triggers = [
    {
      name: "items_active_ai",
      sql: `
        CREATE TRIGGER IF NOT EXISTS items_active_ai AFTER INSERT ON items_active BEGIN
          INSERT INTO items_active_fts(rowid, title, content)
          VALUES (new.rowid, new.title, new.content);
        END;
      `,
    },
    {
      name: "items_active_ad",
      sql: `
        CREATE TRIGGER IF NOT EXISTS items_active_ad AFTER DELETE ON items_active BEGIN
          INSERT INTO items_active_fts(items_active_fts, rowid, title, content)
          VALUES ('delete', old.rowid, old.title, old.content);
        END;
      `,
    },
    {
      name: "items_active_au",
      sql: `
        CREATE TRIGGER IF NOT EXISTS items_active_au AFTER UPDATE OF title, content ON items_active BEGIN
          INSERT INTO items_active_fts(items_active_fts, rowid, title, content)
          VALUES ('delete', old.rowid, old.title, old.content);
          INSERT INTO items_active_fts(rowid, title, content)
          VALUES (new.rowid, new.title, new.content);
        END;
      `,
    },
  ];

  sqlite.transaction(() => {
    const auRow = sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='items_active_au'")
      .get() as { sql: string | null } | undefined;
    if (auRow?.sql && !auRow.sql.includes("AFTER UPDATE OF")) {
      sqlite.exec("DROP TRIGGER IF EXISTS items_active_au");
    }
    for (const trigger of triggers) {
      sqlite.exec(trigger.sql);
    }
  })();

  // Rebuild FTS index when empty (idempotent — rebuild is cheap at small scale).
  const ftsRow = sqlite.prepare("SELECT COUNT(*) AS n FROM items_active_fts").get() as {
    n: number;
  };
  const itemsRow = sqlite.prepare("SELECT COUNT(*) AS n FROM items_active").get() as { n: number };
  if (ftsRow.n === 0 && itemsRow.n > 0) {
    sqlite.exec("INSERT INTO items_active_fts(items_active_fts) VALUES ('rebuild')");
  }
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
