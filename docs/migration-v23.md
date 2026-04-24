# Migration v23 — `items` → `items_active` + `items_vault`

Sparkle v1.4.0.0 splits the single `items` table into two physical tables:

- **`items_active`** — Zettelkasten pipeline (`fleeting` / `developing` / `permanent` / `archived`) and full active state (`paused`, `viewed_at`, `linked_note_id`, `content`). Source of truth for active work.
- **`items_vault`** — exported-note metadata + an immutable 500-char `content_snippet`. The vault `.md` file is the authoritative content; `items_vault` is a read-only mirror used for dashboards and cross-lifecycle preview without hitting the filesystem.

The migration is **one-way**. A v23 database cannot be downgraded to pre-v23 code without restoring a backup. See §5 _Rollback_.

---

## 1. Schema change summary

### Before (v22)

```
items(id, type, title, content, status, priority, due, tags, origin, source, aliases,
      linked_note_id, category_id, viewed_at, paused, paused_at, paused_context,
      is_private, export_path, exported_at, created, modified)
```

All statuses — `fleeting` / `developing` / `permanent` / `exported` / `archived` for notes, `active` / `done` / `archived` for todos, `draft` / `archived` for scratch — lived in one table.

### After (v23)

**`items_active`** — every row from `items` whose `status != 'exported'`:

| Column                                       | Type                                          | Note                                                                                                         |
| -------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| id                                           | TEXT PK                                       | unchanged                                                                                                    |
| type                                         | TEXT                                          | `note` \| `todo` \| `scratch`                                                                                |
| title                                        | TEXT                                          |                                                                                                              |
| content                                      | TEXT                                          | authoritative content for active notes                                                                       |
| status                                       | TEXT                                          | CHECK: `fleeting`, `developing`, `permanent`, `archived`, `active`, `done`, `draft` — `exported` is rejected |
| priority, due, tags, origin, source, aliases |                                               |                                                                                                              |
| linked_note_id                               | TEXT FK → items_active(id) ON DELETE SET NULL | within-active only                                                                                           |
| category_id                                  | TEXT FK → categories(id) ON DELETE SET NULL   |                                                                                                              |
| viewed_at                                    | TEXT                                          | preserved from v22 (R4-BLOCKER-1 guarantee)                                                                  |
| paused, paused_at, paused_context            |                                               | cross-type pause flag                                                                                        |
| is_private                                   | INT                                           |                                                                                                              |
| created, modified                            | TEXT                                          |                                                                                                              |

**`items_vault`** — every row from `items` whose `status = 'exported'`:

| Column                                            | Type                     | Note                                                                    |
| ------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------- |
| id                                                | TEXT PK                  | unchanged from the original `items.id`                                  |
| title, category_id, tags, aliases, source, origin |                          |                                                                         |
| export_path                                       | TEXT                     | path within the vault                                                   |
| exported_at                                       | TEXT NOT NULL            | authoritative export timestamp — vault-watcher does **not** mutate this |
| content_snippet                                   | TEXT NOT NULL DEFAULT '' | 500-char immutable preview (captured at export time)                    |
| created                                           | TEXT NOT NULL            |                                                                         |
| is_private                                        | INT                      |                                                                         |

**Dropped from items_vault** (vault is read-only metadata): `content`, `status`, `priority`, `due`, `modified`, `viewed_at`, `linked_note_id`, `paused`, `paused_at`, `paused_context`.

**Foreign keys & integrity**:

- `items_active.linked_note_id → items_active(id) ON DELETE SET NULL`
- `items_active.category_id → categories(id) ON DELETE SET NULL`
- `items_vault.category_id → categories(id) ON DELETE SET NULL`
- `share_tokens.item_id → items_active(id) ON DELETE CASCADE` — tokens for already-exported items are dropped during migration (exported notes can no longer be shared).
- `vault_files.sparkle_id` references `items_vault(id)` at the application layer (no enforced FK — scanner populates lazily).

**Invariants** (checked by `ops/migration-23-dryrun.sh`):

- Row count preserved: `COUNT(items_active) + COUNT(items_vault) == COUNT(items_pre_v23)`
- `PRAGMA foreign_key_check(items_active)` and `foreign_key_check(items_vault)` both empty
- Every `items_vault` row has `LENGTH(content_snippet) <= 500`

---

## 2. Query translations

Any raw SQL against `items` will **fail after v23**. Translate by status:

| Pre-v23                                                  | Post-v23                                                                                                                                                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SELECT * FROM items WHERE status = 'fleeting'`          | `SELECT * FROM items_active WHERE status = 'fleeting'`                                                                                                                                                                |
| `SELECT * FROM items WHERE status = 'exported'`          | `SELECT * FROM items_vault`                                                                                                                                                                                           |
| `SELECT * FROM items WHERE id = ?`                       | see _Short-ID lookup_ below                                                                                                                                                                                           |
| `SELECT * FROM items`                                    | `SELECT ... FROM items_active UNION ALL SELECT ... FROM items_vault` — normalize columns first                                                                                                                        |
| `UPDATE items SET status = 'exported' WHERE id = ?`      | one of: `INSERT INTO items_vault (...) SELECT FROM items_active WHERE id = ?` then `DELETE FROM items_active WHERE id = ?` in the same transaction, **or** call the existing `exportToObsidian` handler (recommended) |
| `DELETE FROM items WHERE status = 'exported' AND id = ?` | `DELETE FROM items_vault WHERE id = ?` + null `vault_files.sparkle_id` atomically (or use `DELETE /api/items/:id/vault-stub` — see §3)                                                                                |

### Short-ID lookup (cross-table)

Pre-v23, a 4+ char prefix lookup was one query. Post-v23, probe both tables and fail on collision:

```sql
-- 1. active
SELECT 'active' AS tbl, id, title FROM items_active
 WHERE id LIKE ? || '%' LIMIT 2;
-- 2. vault (only if active returned 0 rows)
SELECT 'vault' AS tbl, id, title FROM items_vault
 WHERE id LIKE ? || '%' LIMIT 2;
-- 3. reject if combined result > 1
```

Wikilink resolution (`筆記（xxxxxxxx）`) uses the same two-step probe; collisions preserve the original string rather than overwriting the vault file.

### Cross-table read patterns

Two shapes, depending on whether pagination needs to run in SQL.

**Shape A — SQL `UNION ALL` when pagination must happen in the DB.**
Used in `getRecentItems` (stats.ts). Project vault rows into the active row shape
at query time (synthesize `status='exported'`, `exported_at AS modified`, etc.), then
outer-wrap with `ORDER BY ... LIMIT ? OFFSET ?` so the DB does the work:

```sql
SELECT * FROM (
  SELECT i.id, ..., i.modified, 'created'/'updated' AS activity
    FROM items_active i LEFT JOIN categories c ON i.category_id = c.id
   WHERE i.modified >= datetime('now','-'||?||' days')
     AND i.status != 'archived' AND i.is_private = 0
  UNION ALL
  SELECT v.id, ..., v.exported_at AS modified, 'exported' AS activity
    FROM items_vault v LEFT JOIN categories c ON v.category_id = c.id
   WHERE v.exported_at >= datetime('now','-'||?||' days') AND v.is_private = 0
)
ORDER BY modified DESC, id ASC
LIMIT ? OFFSET ?;
```

**Shape B — two separate SELECTs + JS merge when the result is already bounded.**
Used in `getStats`, `getCategoryDistribution`, `getWeekData`, and `daily-note.queryDayData`.
Counts-by-category are bounded by `#categories`; week/day views are bounded by date
range; `getStats` returns a constant number of aggregates. In each case a UNION in
SQL would be legal but doesn't buy anything, so we fire two queries and merge in JS.

---

## 3. MCP tool behavior diff (13-tool table)

| Tool                         | Pre-v23                                | Post-v23                                                                                                                   | Migration action                                                      |
| ---------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `sparkle_search` (FTS5)      | all statuses incl. exported            | items_active only (FTS5 scope)                                                                                             | use `sparkle_search_obsidian` or `sparkle_search_all` for vault       |
| `sparkle_list_notes`         | returns exported items by default      | **excludes vault** by default; pass `include_vault=true` or `status='exported'` to opt in                                  | update callers expecting `status=exported` rows to pass the new param |
| `sparkle_get_note`           | one-table lookup                       | probes items_active then items_vault; vault rows return `origin: "vault"` + `content_snippet`                              | no caller change; be aware snippet (not full content) is returned     |
| `sparkle_create_note`        | status defaults to `fleeting`          | unchanged                                                                                                                  | —                                                                     |
| `sparkle_update_note`        | any status                             | **409 `VAULT_READONLY`** on vault rows                                                                                     | use `sparkle_write_obsidian` instead                                  |
| `sparkle_advance_note`       | any status                             | **409 `VAULT_READONLY`** on vault rows                                                                                     | vault is end-state; no further advancement                            |
| `sparkle_pause_note`         | any status                             | **409 `VAULT_READONLY`** on vault rows (paused lives on items_active only)                                                 | —                                                                     |
| `sparkle_resume_note`        | any status                             | **409 `VAULT_READONLY`** on vault rows                                                                                     | —                                                                     |
| `sparkle_release_note`       | did not exist                          | **NEW** — hard-deletes `items_vault` row + nulls `vault_files.sparkle_id`; vault `.md` preserved; requires `confirm: true` | use this instead of `DELETE /api/items/:id` on exported items         |
| `sparkle_export_to_obsidian` | marks items.status='exported' in place | moves row from items_active → items_vault atomically, captures 500-char snippet                                            | no caller change                                                      |
| `sparkle_search_obsidian`    | vault FTS                              | unchanged                                                                                                                  | —                                                                     |
| `sparkle_search_all`         | did not previously distinguish sources | returns `source: "active" \| "vault"` per hit                                                                              | —                                                                     |
| `sparkle_list_categories`    | counts across one table                | counts sum of items_active + items_vault                                                                                   | —                                                                     |

Claude.ai connector callers: tool descriptions changed — reconnect to pick up new schemas (§6).

---

## 4. Self-hoster upgrade steps

The migration runs automatically on Sparkle server start. Follow this sequence to stay safe:

1. **Backup** the live DB:
   ```bash
   sudo systemctl stop sparkle
   cp ~/sparkle/data/todo.db ~/sparkle/backups/todo-$(date +%F-%H%M).db
   ```
2. **Dry-run** the migration on the backup:
   ```bash
   ops/migration-23-dryrun.sh ~/sparkle/backups/todo-*.db
   ```
   Exits non-zero if any invariant fails. Inspect the script's diagnostic output — the in-place assertions cover row count, schema shape, FK integrity, and snippet length.
3. **Deploy the new code**:
   ```bash
   cd ~/sparkle
   git fetch && git checkout v1.4.0.0   # or main if past
   npm ci && npm run build
   (cd mcp-server && npm ci && npm run build)
   ```
4. **Start the service** — the migration runs during boot:
   ```bash
   sudo systemctl start sparkle
   sudo journalctl -u sparkle -f | grep "migration"
   ```
   Expect `migrated to schema_version=23`.
5. **Verify** (these should all return as expected):
   ```bash
   # App migration version (not SQLite's PRAGMA — that's an internal counter).
   sqlite3 ~/sparkle/data/todo.db "SELECT version FROM schema_version"   # 23
   sqlite3 ~/sparkle/data/todo.db \
     "SELECT (SELECT COUNT(*) FROM items_active) + (SELECT COUNT(*) FROM items_vault) AS total"
   curl -s http://localhost:3000/api/health | jq .status
   ```
6. **Reconnect the Claude.ai MCP connector** — see §6.
7. **Canary**: leave Sparkle running, monitor `/api/health`, and confirm the dashboard renders recent / week / category distribution correctly. `items_vault` rows should appear in `最近活動` with the `匯出` badge.

---

## 5. Rollback

Rollback is **only valid for backups taken after v23 was deployed**. Pre-v23 `.db` files have the legacy `items` table; post-v23 code cannot boot against them without also reverting Sparkle.

```bash
sudo ops/rollback-migration-23.sh <backup.db> <rollback-sha>
```

The script enforces pre-flight checks:

- Backup exists and is `schema_version = 23`
- Repo has no uncommitted changes
- `<rollback-sha>` looks like a hex sha

It then: stops the service, restores the DB (clearing `.shm`/`.wal`), checks out a named rollback branch at the given SHA (never detached HEAD), rebuilds, restarts the service, and curls `/api/health`.

If you need to roll back to a **pre-v23** backup, you must also revert Sparkle to a pre-v23 commit (e.g. `5a6db2c` — tag `v1.3.3.0`). The rollback script refuses pre-v23 backups by design.

---

## 6. Claude.ai connector reconnect

MCP tool descriptions changed in v1.4.0.0. Claude.ai caches tool schemas per connector; existing chats may see stale descriptions until you reconnect:

1. Open Claude.ai → **Settings** → **Connectors**.
2. Find the **Sparkle** connector and click **Reconnect** (not **Delete** — the connector config and OAuth credentials stay).
3. Start a new chat to pick up the refreshed tool list.

You should now see:

- `sparkle_release_note` as a new tool.
- `sparkle_list_notes` description mentions the `include_vault` parameter.
- `sparkle_search` description guides to `sparkle_search_all` for cross-source search.
- `sparkle_update_note` / `sparkle_advance_note` / `sparkle_pause_note` / `sparkle_resume_note` descriptions call out the `VAULT_READONLY` return on vault items.

If tool descriptions still look stale, toggle the connector off and on once. A full delete + re-pair is **not** necessary (and costs you the OAuth handshake).
