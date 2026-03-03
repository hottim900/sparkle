# Category Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a user-defined category field to items for grouped list browsing.

**Architecture:** New `categories` table with CRUD API. Items get nullable `category_id` FK. Frontend list view groups by category. MCP server exposes category tools. Obsidian export includes category in frontmatter.

**Tech Stack:** SQLite, Drizzle ORM, Hono, Zod, React, TypeScript, Vitest, Playwright

---

## PR1: Database Migration (HIGH RISK)

Branch: `feat/category-db-migration`

### Task 1: Migration 12→13 — Create categories table + add category_id to items

**Files:**
- Modify: `server/db/index.ts` (TARGET_VERSION + migration step + fresh install)
- Modify: `server/db/schema.ts` (categories table + category_id column)
- Modify: `server/test-utils.ts` (categories table + category_id in test DB)

**Step 1: Update schema.ts — add categories table and category_id**

Add after `shareTokens` definition in `server/db/schema.ts`:

```typescript
export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  sort_order: index("sort_order").notNull().default(0),
  color: text("color"),
  created: text("created").notNull(),
  modified: text("modified").notNull(),
});

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
```

Note: Use `import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";` — add `integer` to the import. `sort_order` uses `integer("sort_order")` not `index()`.

Add `category_id` to items table definition:

```typescript
category_id: text("category_id"),
```

Add index:

```typescript
index("idx_items_category_id").on(table.category_id),
```

**Step 2: Update index.ts — add migration 12→13**

Change `TARGET_VERSION` from 12 to 13.

Add migration step after version 12 block:

```typescript
// Step 12→13: Create categories table + add category_id to items
if (version < 13) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      color TEXT DEFAULT NULL,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order);
  `);

  try {
    sqlite.exec("ALTER TABLE items ADD COLUMN category_id TEXT DEFAULT NULL REFERENCES categories(id) ON DELETE SET NULL");
  } catch (e: unknown) {
    const msg = (e as Error).message || "";
    if (!msg.includes("duplicate column")) throw e;
  }

  try {
    sqlite.exec("CREATE INDEX IF NOT EXISTS idx_items_category_id ON items(category_id)");
  } catch {
    // Index may already exist
  }

  setSchemaVersion(sqlite, 13);
}
```

Update fresh install SQL block — add categories table creation and category_id column to items:

In the `CREATE TABLE items` block, add `category_id TEXT DEFAULT NULL,` before `created TEXT NOT NULL,` and add `FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL` after the linked_note_id FK.

Add categories table creation after share_tokens in fresh install:

```sql
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT DEFAULT NULL,
  created TEXT NOT NULL,
  modified TEXT NOT NULL
);
CREATE INDEX idx_categories_sort_order ON categories(sort_order);
```

**Step 3: Update test-utils.ts**

Add `category_id TEXT DEFAULT NULL,` to items CREATE TABLE (before `created`). Add FK: `FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL`.

Add categories table creation:

```sql
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT DEFAULT NULL,
  created TEXT NOT NULL,
  modified TEXT NOT NULL
);
```

**Step 4: Write migration test**

Create `server/db/__tests__/migration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";

// Test migration 12→13 specifically
describe("migration 12→13", () => {
  it("should create categories table and add category_id to items", () => {
    // Create in-memory DB at version 12 (pre-migration state)
    const sqlite = new Database(":memory:");
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");

    // Create items table at version 12 schema (without category_id)
    sqlite.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (12);

      CREATE TABLE items (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'note',
        title TEXT NOT NULL,
        content TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'fleeting',
        priority TEXT,
        due TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        origin TEXT DEFAULT '',
        source TEXT DEFAULT NULL,
        aliases TEXT NOT NULL DEFAULT '[]',
        linked_note_id TEXT DEFAULT NULL,
        created TEXT NOT NULL,
        modified TEXT NOT NULL,
        FOREIGN KEY (linked_note_id) REFERENCES items(id) ON DELETE SET NULL
      );
      CREATE INDEX idx_items_status ON items(status);
      CREATE INDEX idx_items_type ON items(type);
      CREATE INDEX idx_items_created ON items(created DESC);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE share_tokens (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        visibility TEXT NOT NULL DEFAULT 'unlisted',
        created TEXT NOT NULL,
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
      );
    `);

    // Insert a test item
    sqlite.exec(`
      INSERT INTO items (id, title, created, modified)
      VALUES ('test-1', 'Test Item', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `);

    // Run migration by importing and calling it
    // We test the SQL directly here to avoid coupling to the full createDb flow
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        color TEXT DEFAULT NULL,
        created TEXT NOT NULL,
        modified TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order);
    `);

    try {
      sqlite.exec("ALTER TABLE items ADD COLUMN category_id TEXT DEFAULT NULL REFERENCES categories(id) ON DELETE SET NULL");
    } catch (e: unknown) {
      const msg = (e as Error).message || "";
      if (!msg.includes("duplicate column")) throw e;
    }

    sqlite.exec("CREATE INDEX IF NOT EXISTS idx_items_category_id ON items(category_id)");
    sqlite.exec("UPDATE schema_version SET version = 13");

    // Verify categories table exists
    const catTable = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='categories'"
    ).get();
    expect(catTable).toBeTruthy();

    // Verify category_id column exists on items
    const item = sqlite.prepare("SELECT category_id FROM items WHERE id = 'test-1'").get() as { category_id: string | null };
    expect(item.category_id).toBeNull();

    // Verify FK works — inserting category and linking
    sqlite.exec(`
      INSERT INTO categories (id, name, sort_order, created, modified)
      VALUES ('cat-1', 'Test Category', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `);
    sqlite.exec("UPDATE items SET category_id = 'cat-1' WHERE id = 'test-1'");

    const updated = sqlite.prepare("SELECT category_id FROM items WHERE id = 'test-1'").get() as { category_id: string };
    expect(updated.category_id).toBe("cat-1");

    // Verify ON DELETE SET NULL
    sqlite.exec("DELETE FROM categories WHERE id = 'cat-1'");
    const afterDelete = sqlite.prepare("SELECT category_id FROM items WHERE id = 'test-1'").get() as { category_id: string | null };
    expect(afterDelete.category_id).toBeNull();

    // Verify schema version
    const version = sqlite.prepare("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(13);
  });

  it("should be idempotent (running twice does not error)", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    sqlite.exec(`
      CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version (version) VALUES (12);
      CREATE TABLE items (
        id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'note', title TEXT NOT NULL,
        content TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'fleeting', priority TEXT,
        due TEXT, tags TEXT NOT NULL DEFAULT '[]', origin TEXT DEFAULT '',
        source TEXT DEFAULT NULL, aliases TEXT NOT NULL DEFAULT '[]',
        linked_note_id TEXT DEFAULT NULL, created TEXT NOT NULL, modified TEXT NOT NULL
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE share_tokens (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, token TEXT NOT NULL UNIQUE, visibility TEXT NOT NULL DEFAULT 'unlisted', created TEXT NOT NULL);
    `);

    // Run migration twice
    for (let i = 0; i < 2; i++) {
      sqlite.exec("CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0, color TEXT DEFAULT NULL, created TEXT NOT NULL, modified TEXT NOT NULL)");
      sqlite.exec("CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order)");
      try {
        sqlite.exec("ALTER TABLE items ADD COLUMN category_id TEXT DEFAULT NULL REFERENCES categories(id) ON DELETE SET NULL");
      } catch (e: unknown) {
        const msg = (e as Error).message || "";
        if (!msg.includes("duplicate column")) throw e;
      }
      sqlite.exec("CREATE INDEX IF NOT EXISTS idx_items_category_id ON items(category_id)");
    }

    // Should not throw
    const catTable = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='categories'").get();
    expect(catTable).toBeTruthy();
  });
});
```

**Step 5: Run tests**

```bash
npx vitest run server/db/__tests__/migration.test.ts
```

**Step 6: Run full test suite to verify no regressions**

```bash
npx vitest run
```

**Step 7: Lint and format**

```bash
npm run lint:fix && npm run format
```

**Step 8: Commit and create PR**

```bash
git add server/db/index.ts server/db/schema.ts server/test-utils.ts server/db/__tests__/migration.test.ts
git commit -m "feat: add categories table and category_id to items (migration 12→13)"
```

---

## PR2: Backend API (MEDIUM RISK)

Branch: `feat/category-backend-api` (from main after PR1 merges)

### Task 2A: Categories CRUD library + tests

**Files:**
- Create: `server/lib/categories.ts`
- Create: `server/lib/__tests__/categories.test.ts`
- Create: `server/schemas/categories.ts`

**categories.ts functions:**
- `createCategory(db, { name, color? })` → Category
- `getCategory(db, id)` → Category | null
- `listCategories(db)` → Category[] (sorted by sort_order)
- `updateCategory(db, id, { name?, color?, sort_order? })` → Category | null
- `deleteCategory(db, id)` → boolean
- `reorderCategories(db, items: { id: string, sort_order: number }[])` → void

**categories.ts schema:**
```typescript
import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  color: z.string().max(20).nullable().default(null),
});

export const updateCategorySchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().max(20).nullable().optional(),
  sort_order: z.number().int().min(0).optional(),
});

export const reorderCategoriesSchema = z.object({
  items: z.array(z.object({
    id: z.string().uuid(),
    sort_order: z.number().int().min(0),
  })).min(1),
});
```

TDD: Write tests first for each function, then implement.

### Task 2B: Categories routes + items integration + export

**Files:**
- Create: `server/routes/categories.ts`
- Modify: `server/index.ts` (register categoriesRouter)
- Modify: `server/schemas/items.ts` (add category_id to create/update/list schemas)
- Modify: `server/lib/items.ts` (add category_id to CRUD + category_name computed field)
- Modify: `server/lib/export.ts` (add category_name to ExportableItem + frontmatter)

**Items integration details:**

In `server/schemas/items.ts`:
- `createItemSchema`: add `category_id: z.string().uuid().nullable().default(null)`
- `updateItemSchema`: add `category_id: z.string().uuid().nullable().optional()`
- `listItemsSchema`: add `category_id: z.string().uuid().optional()`

In `server/lib/items.ts`:
- `ItemWithLinkedInfo` type: add `category_name: string | null`
- `resolveLinkedInfo()`: batch-resolve category names from category_id
- `createItem()`: include category_id in insert values
- `updateItem()`: include category_id in updates (preserve on type conversion, including scratch)
- `listItems()`: add category_id filter condition

In `server/lib/export.ts`:
- `ExportableItem`: add `category_name: string | null`
- `generateFrontmatter()`: add `category: <name>` line when non-null (after sparkle_id, before tags)

In `server/routes/items.ts`:
- GET list: pass `category_id` from query param
- POST export: pass category_name to ExportableItem

**Route registration** in `server/index.ts`:
```typescript
import { categoriesRouter } from "./routes/categories.js";
// ...
app.route("/api/categories", categoriesRouter);
```

### Task 2C: Backend tests for items integration + export

**Files:**
- Modify: `server/lib/__tests__/items.test.ts` (category_id in create/update/list/type-conversion)
- Modify: `server/lib/__tests__/export.test.ts` (category in frontmatter)
- Modify: `server/routes/__tests__/api.test.ts` (category endpoints + items with category)

---

## PR3: Frontend (LOW RISK)

Branch: `feat/category-frontend` (from main after PR2 merges)

### Task 3A: Types + API client + CategorySelect component

**Files:**
- Modify: `src/lib/types.ts` (Category interface, Item gets category_id + category_name)
- Modify: `src/lib/api.ts` (category API functions)
- Create: `src/components/category-select.tsx`
- Create: `src/components/__tests__/category-select.test.tsx`

**Types additions:**
```typescript
export interface Category {
  id: string;
  name: string;
  sort_order: number;
  color: string | null;
  created: string;
  modified: string;
}

export interface CategoriesResponse {
  categories: Category[];
}
```

Item interface adds: `category_id: string | null;` and `category_name: string | null;`

**API functions:**
```typescript
export async function listCategories(): Promise<CategoriesResponse> { ... }
export async function createCategory(input: { name: string; color?: string | null }): Promise<Category> { ... }
export async function updateCategory(id: string, input: { name?: string; color?: string | null; sort_order?: number }): Promise<Category> { ... }
export async function deleteCategory(id: string): Promise<void> { ... }
export async function reorderCategories(items: { id: string; sort_order: number }[]): Promise<void> { ... }
```

**CategorySelect component:**
- Dropdown showing categories sorted by sort_order
- "未分類" option at top (value: null)
- "+ 新增分類" option at bottom → inline text input → calls createCategory → selects it
- Props: `value: string | null`, `onChange: (id: string | null) => void`

### Task 3B: Item detail + item card + item list modifications

**Files:**
- Modify: `src/components/item-detail.tsx` (add CategorySelect field)
- Modify: `src/components/item-card.tsx` (show category badge)
- Modify: `src/components/item-list.tsx` (group by category)
- Modify: `src/components/__tests__/item-detail.test.tsx`
- Modify: `src/components/__tests__/item-list.test.tsx`

**item-list.tsx grouped view:**
- Fetch categories on mount
- Group items by category_id
- Render collapsible sections with category name as header + item count
- "未分類" section at bottom
- Sections sorted by category sort_order

### Task 3C: Category management UI

**Files:**
- Create: `src/components/category-management.tsx`
- Create: `src/components/__tests__/category-management.test.tsx`
- Modify: `src/components/settings.tsx` (add category management section)

**CategoryManagement component:**
- List all categories with name, color badge, drag handle for reorder
- Inline edit name
- Color picker (simple preset colors)
- Delete button with confirmation ("刪除後，相關項目將變為未分類")
- Add new category button

---

## PR4: MCP Server + E2E + Documentation (LOW RISK)

Branch: `feat/category-mcp-e2e-docs` (from main after PR2 merges, parallel with PR3)

### Task 4A: MCP server updates

**Files:**
- Modify: `mcp-server/src/types.ts` (Category type, SparkleItem + category_id)
- Modify: `mcp-server/src/client.ts` (category API client functions)
- Create: `mcp-server/src/tools/categories.ts` (list/create/update/delete tools)
- Modify: `mcp-server/src/tools/write.ts` (category_id in create/update)
- Modify: `mcp-server/src/tools/read.ts` (category_id filter in list)

### Task 4B: E2E tests

**Files:**
- Modify: `e2e/helpers.ts` (createCategory helper, selectCategory helper)
- Create: `e2e/categories.spec.ts` (category CRUD + item assignment + grouped view)

### Task 4C: Documentation updates

**Files:**
- Modify: `CLAUDE.md` (data model section: category_id field, categories table)
- Modify: `.claude/skills/project-structure.md` (new files)
- Modify: `.claude/skills/conventions-detail.md` (category conventions)
- Modify: `.claude/skills/mcp-server.md` (new MCP tools)
