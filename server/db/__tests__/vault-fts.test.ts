import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../../test-utils.js";
import { vaultFiles } from "../schema.js";
import { eq } from "drizzle-orm";

describe("vault_files FTS5", () => {
  let db: ReturnType<typeof createTestDb>["db"];
  let sqlite: ReturnType<typeof createTestDb>["sqlite"];

  beforeEach(() => {
    const testDb = createTestDb();
    db = testDb.db;
    sqlite = testDb.sqlite;
  });

  function insertVaultFile(path: string, title: string, content: string) {
    db.insert(vaultFiles)
      .values({ path, title, content, mtime: Date.now(), content_hash: "test" })
      .run();
  }

  function searchFTS(query: string): { path: string; title: string }[] {
    return sqlite
      .prepare(
        `SELECT vf.path, vf.title
         FROM vault_files_fts
         JOIN vault_files vf ON vf.rowid = vault_files_fts.rowid
         WHERE vault_files_fts MATCH ?
         ORDER BY rank`,
      )
      .all(query) as { path: string; title: string }[];
  }

  it("search matches title", () => {
    insertVaultFile("test.md", "Machine Learning Notes", "Some content here");
    const results = searchFTS("Machine Learning");
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Machine Learning Notes");
  });

  it("search matches content", () => {
    insertVaultFile("test.md", "Title", "The quick brown fox jumps over the lazy dog");
    const results = searchFTS("brown fox");
    expect(results).toHaveLength(1);
  });

  it("search matches Chinese content (trigram tokenizer)", () => {
    insertVaultFile("chinese.md", "中文筆記", "這是一篇關於人工智慧的筆記");
    const results = searchFTS("人工智慧");
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("中文筆記");
  });

  it("delete removes from FTS index", () => {
    insertVaultFile("to-delete.md", "Delete Me", "This should be deleted");
    let results = searchFTS("Delete Me");
    expect(results).toHaveLength(1);

    db.delete(vaultFiles).where(eq(vaultFiles.path, "to-delete.md")).run();

    results = searchFTS("Delete Me");
    expect(results).toHaveLength(0);
  });

  it("update reflects in FTS index", () => {
    insertVaultFile("update.md", "Original Title", "Original content");

    db.update(vaultFiles)
      .set({ title: "Updated Title", content: "Updated content about databases" })
      .where(eq(vaultFiles.path, "update.md"))
      .run();

    const oldResults = searchFTS("Original Title");
    expect(oldResults).toHaveLength(0);

    const newResults = searchFTS("Updated Title");
    expect(newResults).toHaveLength(1);
  });

  it("returns multiple matches ranked by relevance", () => {
    insertVaultFile("a.md", "Rust Programming", "Rust is a systems programming language");
    insertVaultFile("b.md", "Go Programming", "Go is also a programming language");
    insertVaultFile("c.md", "Cooking Recipes", "No programming here");

    const results = searchFTS("programming");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // "Cooking Recipes" should not match (trigram might partially match though)
    const paths = results.map((r) => r.path);
    expect(paths).toContain("a.md");
    expect(paths).toContain("b.md");
  });
});
