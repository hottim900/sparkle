# Category Feature Design

## Problem

Sparkle's note/todo list is flat. As items grow, users can't scan the list efficiently — everything is mixed together with no visual grouping.

## Decision Record

Explored and rejected: PARA Areas (methodology mismatch), MOC+Wikilink (scope creep — building mini-Obsidian), nested tags (tech debt, Obsidian Bases incompatibility), flat tag group-by (too granular, multi-tag ambiguity). Full discussion captured in Sparkle note "Sparkle 分類系統設計決策".

## Solution

Add an independent `category` field — single-select, nullable, user-defined. Tag stays for fine-grained multi-dimensional labeling; category handles coarse-grained browse grouping. Compatible with Zettelkasten (no semantic hierarchy imposed).

## Database Schema

### New table: `categories`

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

### Items table change

```sql
ALTER TABLE items ADD COLUMN category_id TEXT DEFAULT NULL
  REFERENCES categories(id) ON DELETE SET NULL;
CREATE INDEX idx_items_category_id ON items(category_id);
```

Migration: 12→13. ALTER TABLE ADD COLUMN (no table recreation needed). Fresh install updated to include categories table and category_id column.

## Backend API

### Categories CRUD — `/api/categories`

| Method | Path                       | Purpose                          |
| ------ | -------------------------- | -------------------------------- |
| GET    | `/api/categories`          | List all (sorted by sort_order)  |
| POST   | `/api/categories`          | Create new category              |
| PATCH  | `/api/categories/:id`      | Update name/color/sort_order     |
| DELETE | `/api/categories/:id`      | Delete (items become uncategorized) |
| PATCH  | `/api/categories/reorder`  | Batch update sort_order          |

### Items API changes

- `POST /api/items`: accept optional `category_id`
- `PATCH /api/items/:id`: accept `category_id` (nullable, send `null` to clear)
- `GET /api/items`: add `category_id` query param for filtering; response includes computed `category_name`
- Type conversion to scratch: `category_id` preserved (browsing aid, not type-dependent)

## Obsidian Export

Add `category` to frontmatter (name, not ID). Only present when non-null:

```yaml
---
sparkle_id: "uuid"
category: 居家
tags:
  - 防水
---
```

## Frontend

### New components

- `category-select.tsx` — reusable dropdown with "+ 新增分類" inline creation
- `category-management.tsx` — CRUD interface (rename, reorder, color, delete), accessed from settings

### Modified components

- `item-detail.tsx` — add category dropdown
- `item-list.tsx` — default group-by-category display with collapsible sections; uncategorized items last
- `item-card.tsx` — category badge display
- `api.ts` — category API functions
- `types.ts` — Category type, Item gets `category_id` + `category_name`

### Unchanged

- `quick-capture.tsx` — no category at capture time (just-in-time filing)
- `sidebar.tsx` — no category filter (group-by solves the core problem)
- `dashboard.tsx` — no changes

## MCP Server

- `types.ts`: Category type, SparkleItem gets `category_id`
- `client.ts`: categories API client functions
- New `tools/categories.ts`: list/create/update/delete tools
- `tools/write.ts`: create/update item supports `category_id`
- `tools/read.ts`: list items supports `category_id` filter

## PR Decomposition

| PR  | Risk   | Content                                              |
| --- | ------ | ---------------------------------------------------- |
| PR1 | High   | DB migration + schema + test-utils                   |
| PR2 | Medium | Backend categories CRUD + items integration + export |
| PR3 | Low    | Frontend components + grouped list                   |
| PR4 | Low    | MCP server + E2E tests + documentation               |

Merge order: PR1 → deploy + verify → PR2 → PR3 + PR4 (parallel).
