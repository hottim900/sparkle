# server/db — schema notes for Sparkle

This document is a **why** reference. Schema declarations live in `schema.ts`;
migrations live in `index.ts` (`migrate` function). Read this when you are about
to write a raw-SQL query or add a migration, so you understand the invariants
the rest of the system relies on.

## 1. Why two tables (items_active + items_vault)

Sparkle's active lifecycle — Zettelkasten maturity plus todo/scratch — is a
mutable pipeline. Exported notes, however, are a _different_ object: the vault
`.md` file is the source of truth, and Sparkle holds only a thin metadata
pointer. Keeping both in one table created three recurring bugs:

1. **Dashboard queries leaked exported items** into "needs attention" /
   "overdue" / "stale" views. Every new query required the dev to remember yet
   another `AND status != 'exported'` filter (matching the `paused = 0` and
   `is_private = 0` filters already in place).
2. **Schema mismatch**: exported rows needed fields that active rows did not
   (e.g. an export-path snapshot, retired in v25 in favour of vault_files
   reverse-lookup), and active rows needed fields (`paused`, `viewed_at`,
   `linked_note_id`, `content`) that exported rows did not. NULL-on-one-side
   meant CHECK constraints and indexes were either overly permissive or had
   conditional clauses.
3. **Content authority drift**: a content-sync watcher used to reconcile
   Sparkle's `items.content` against the vault's `.md`, which required
   `contentHash`, `stripFrontmatter`, and a content-mtime cache. Each layer
   produced its own class of bugs (mtime races, frontmatter diff noise).

The split (PR #312, migration 23) enforces the distinction structurally:

- `items_active` keeps `paused`, `viewed_at`, `linked_note_id`, `content`, and
  the pipeline statuses. CHECK constraint rejects `status = 'exported'`.
- `items_vault` is pure metadata + an immutable 500-char `content_snippet`
  captured at export time. No `content`, `status`, `paused`, `viewed_at`,
  `linked_note_id`, `priority`, `due`, `modified`. Writes (from the app) go
  through `sparkle_export_to_obsidian` (to insert) and `sparkle_release_note`
  / `DELETE /api/items/:id/vault-stub` (to delete). Content changes go to the
  vault `.md` directly — there is no Sparkle-side process that round-trips
  vault content; the 5-min vault scanner only indexes paths/frontmatter for
  reverse-lookup.

Tradeoff: two-table joins (UNION ALL + JS merge) appear in four dashboard
queries. We accept the cost because the table name forces correct thinking:
writing `FROM items_active` makes it obvious that exported items are out of
scope; writing `FROM items_vault` makes it obvious that active-only columns
(`paused`, `linked_note_id`, `modified`) aren't available.

See `docs/migration-v23.md` for the upgrade playbook.

## 2. Cross-table FK + app-layer constraints

SQLite enforces foreign keys only within a single table definition. The
schema uses FKs where they work and supplements with app-layer checks where
they don't:

- **`items_active.category_id → categories(id) ON DELETE SET NULL`** — FK
  enforced. Deleting a category nulls active rows' category_id.
- **`items_vault.category_id → categories(id) ON DELETE SET NULL`** — FK
  enforced. Deleting a category also nulls vault rows' category_id in the same
  cascade.
- **`items_active.linked_note_id → items_active(id) ON DELETE SET NULL`** — FK
  enforced within active only. Linking to a vault row is **not** supported via
  this FK; cross-lifecycle links are rendered via `linked_note_origin` derived
  at read time.
- **`share_tokens.item_id → items_active(id) ON DELETE CASCADE`** — FK
  enforced. Exported notes cannot be shared; the v23 migration dropped all
  share_tokens whose item_id now lives in items_vault.
- **`vault_files.sparkle_id`** — **no FK**. The vault scanner populates this
  lazily (filesystem-driven), and the column is nullable. Integrity is
  maintained by (a) `sparkle_release_note` nulls the column in the same
  transaction as the `items_vault` delete, and (b) the 5-min vault scanner
  re-asserts `vault_files.sparkle_id` from on-disk frontmatter, so renames
  and moves resurface within one cycle.

When writing migrations or routes, **use transactions** whenever an operation
touches both `items_vault` and `vault_files` (see
`server/lib/items.ts::deleteVaultItem` for the canonical pattern).

## 3. FTS5 scope (active only)

`items_active_fts` (trigram tokenizer, Chinese support) mirrors
`items_active.content + title + tags`. There is **no FTS5 table for
items_vault** — the vault `.md` files are searched via the
`vault_files_fts` table built from filesystem content at scan time.

Consequence: `sparkle_search` returns only active rows. Cross-source search is
`sparkle_search_all` (unions the two FTS tables), and vault-only search is
`sparkle_search_obsidian`.

If a vault-origin query seems to miss hits: it likely means the scanner
hasn't indexed the file yet, or the query is hitting `items_active_fts`
instead of `vault_files_fts`.

## 4. Migration v23 dry-run protocol

Before merging the v23 PR and before deploying to production:

```bash
ops/migration-23-dryrun.sh ~/sparkle/backups/todo-YYYY-MM-DD.db
```

The script:

1. Copies the source DB to `/tmp/sparkle-migration-test.db` (overwritten each
   run).
2. Snapshots the pre-migration row count against the legacy `items` table.
3. Runs the v23 migration SQL against the copy.
4. Asserts — any failure exits non-zero:
   - `COUNT(items_active) + COUNT(items_vault) == pre-migration COUNT(items)`
   - `PRAGMA table_info(items_active)` contains `viewed_at` (R4-BLOCKER-1)
   - `PRAGMA table_info(items_vault)` excludes `content`, `status`, `paused`,
     `viewed_at` and includes `content_snippet`
   - `PRAGMA foreign_key_check(items_active)` and `foreign_key_check(items_vault)`
     both empty
   - Every vault row has `LENGTH(content_snippet) <= 500`
   - No `items_active` row has `status = 'exported'` (CHECK enforcement)

Run it on a copy of production every time the migration SQL changes. Never
trust a unit-test fixture alone — production data has 18-month-old rows the
tests don't exercise.

## 5. Checking DB state (cross-table queries)

Standard checks when you're debugging on a live box:

```sql
-- Row totals per table
SELECT 'active' AS tbl, COUNT(*) FROM items_active
UNION ALL SELECT 'vault', COUNT(*) FROM items_vault;

-- Combined view for dashboard sanity-check
SELECT id, type, title, 'active' AS origin, status, modified
  FROM items_active
 UNION ALL
SELECT id, 'note' AS type, title, 'vault' AS origin, 'exported' AS status,
       exported_at AS modified
  FROM items_vault
 ORDER BY modified DESC
 LIMIT 20;

-- Orphaned share_tokens (should always be empty post-v23)
SELECT st.id, st.item_id FROM share_tokens st
  LEFT JOIN items_active i ON st.item_id = i.id
 WHERE i.id IS NULL;

-- Dangling linked_note_id (vault-stub deletes leave active rows pointing nowhere)
SELECT id, title, linked_note_id FROM items_active
 WHERE linked_note_id IS NOT NULL
   AND linked_note_id NOT IN (SELECT id FROM items_active)
   AND linked_note_id NOT IN (SELECT id FROM items_vault);

-- vault_files with no matching vault row
SELECT vf.relative_path, vf.sparkle_id FROM vault_files vf
  LEFT JOIN items_vault v ON vf.sparkle_id = v.id
 WHERE vf.sparkle_id IS NOT NULL AND v.id IS NULL;
```

## 6. Rollback

Rollback is scripted: `ops/rollback-migration-23.sh <backup.db> <rollback-sha>`.

**Valid only for `.db` backups taken after v23 was deployed.** Pre-v23 backups
have the legacy `items` table — restoring one alongside post-v23 code leaves
the server unable to boot. The script refuses to proceed if the backup's
`schema_version` is not 23.

Procedure the script runs (see the script header for the authoritative
sequence):

1. Pre-flight — backup exists, `schema_version = 23`, repo clean, rollback
   SHA is hex.
2. `systemctl stop sparkle`.
3. Copy the backup over the live DB (clearing `.shm` / `.wal`).
4. `git checkout -B rollback-v23-$(date +%s) <rollback-sha>` — named branch,
   never detached HEAD.
5. `npm run build`.
6. `systemctl start sparkle`.
7. `curl /api/health`.

If your only backup is pre-v23, you must revert Sparkle code too — pick a
pre-v23 commit (e.g. `5a6db2c` / tag `v1.3.3.0`) and restore the matching
backup against it. Migration 23 is effectively one-way once production data
has been committed.
