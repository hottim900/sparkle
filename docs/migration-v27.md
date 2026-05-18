# Migration v27 — Legacy `筆記（xxxxxxxx）` → `[[Title]]` Backfill

Status: **Locked** (PR 4 of the wikilink-first cross-references rollout).
Related: `docs/wikilink-spec.md`, `docs/migration-v25.md` (backup-safeguard pattern).

## What v27 does

v27 is a one-shot data backfill that rewrites every legacy `筆記（xxxxxxxx）` short-ID reference in `items_active.content` to the canonical `[[Title]]` wikilink syntax shipped in v1.5.1.0 (PR 1).

After v27, Sparkle's writing surface is uniform: all cross-references render via the same Obsidian-native renderer, the rename engine (PR 3) can rewrite them on title changes, and the legacy `筆記（` syntax is retired from active content.

Vault `.md` files are **NOT** touched (Pre-PR0d carve-out, see `docs/wikilink-spec.md`). Vault is SSOT post-v25; Obsidian-side cleanup is the user's choice via Obsidian's own rename feature.

## Scope (conservative)

v27 only rewrites the `筆記（xxxxxxxx）` pattern where:

- The short ID is 4–8 lowercase hex chars (matches the legacy `筆記（` writer in `server/lib/export.ts:108`).
- The match is **not** inside a fenced code block (` ``` ` or `~~~`) or inline backtick span. Code-block skipping mirrors the live parser (`src/lib/wikilink.ts`) so the migration matches the running renderer's behavior (ENG-26).
- The short ID resolves to **exactly one** non-private item (across `items_active` + `items_vault`, active-priority). Ambiguous prefixes (≥2 matches) are left in place and recorded in `backfill_v27_ambiguous` for operator review.

v27 explicitly does **NOT** rewrite:

- Bare hex IDs (e.g. `abcd1234` written without `筆記（）` wrapping). False-positive risk is high — commit hashes, vault filenames, and other technical content overlap that surface.
- References that target a deleted or private item. Verbatim text stays so a future search can find them.
- `[[Title|sparkle-<shortId>]]` style references in vault daily-notes (vault is out of scope).

## Backup safeguards

v27 follows the v25-pattern backup rules:

1. **Unique per-run backup path**: `~/sparkle-backups/todo.db.bak-pre-v27-<ms>-<pid>-<uuid8>` — guards against millisecond-collision when systemd restarts in tight loop and against parallel migration attempts.
2. **Pre-flight disk check**: requires 1.2× DB size free at the backup dir; throws `migration_v27_halted_no_disk` otherwise.
3. **Post-backup verify**: opens the backup as readonly, asserts `PRAGMA integrity_check = "ok"` and `schema_version = 26`. Throws `migration_v27_halted_backup_failed` otherwise.
4. **No-op skip**: when no item contains the legacy pattern, the migration skips the backup and just stamps `schema_version = 27`. Fresh installs and vault-only deployments incur zero backup cost.

On any halt, the v27 path throws `V27HaltError` which `createDb` catches and routes through `haltAndExit` → `process.exit(78)`. Pairs with systemd `RestartPreventExitStatus=78` so the operator sees a stable error window instead of a restart loop.

## Halt: `migration_v27_halted_no_disk`

The backup directory has less free space than `1.2 × DB size`. Free up space (e.g. trim old daily backups under `~/sparkle-backups/`) and restart sparkle.

Override the backup directory with `SPARKLE_MIGRATION_BACKUP_DIR=/path/to/dir` if you need to point at a different volume.

## Halt: `migration_v27_halted_backup_failed`

`VACUUM INTO` or the post-write integrity verify failed. Common causes:

- The backup directory exists but the running user doesn't have write permission. Fix: `chown -R sparkle:sparkle ~/sparkle-backups/`.
- Disk hardware error. Fix: check `dmesg`, run `fsck`, restore from off-host backup if corrupt.
- Stale backup file at the unique path (extremely unlikely given the UUID suffix). Fix: remove the file and restart.

The migration aborts before the backfill writes anything, so `items_active.content` is unchanged. Schema version stays at 26.

## What if v27 misclassifies a reference?

The conservative scope minimizes false positives, but if v27 rewrites a `筆記（xxxx）` that should have been left alone:

1. Restore from the pre-v27 backup at `~/sparkle-backups/todo.db.bak-pre-v27-*`.
2. Stop sparkle (`sudo systemctl stop sparkle`).
3. Move the corrupt DB aside (`mv ~/sparkle/data/todo.db ~/sparkle/data/todo.db.corrupt`).
4. Copy the backup into place (`cp ~/sparkle-backups/todo.db.bak-pre-v27-<ts> ~/sparkle/data/todo.db`).
5. Restart sparkle. Schema is at 26; the migration will retry on next start unless you patch the scope and re-deploy.

If you need to keep the backfilled changes but undo a specific row, use the rename engine's undo flow (`POST /api/wikilinks/admin/undo-rename/:historyId`) — but v27 doesn't write `rename_history` rows since it's not a per-row rename. For per-row rollback, edit `items_active.content` directly via SQL or the `sparkle_edit_note` MCP tool.

## Ambiguous queue

The `backfill_v27_ambiguous` table records every short-id whose prefix matched ≥2 items:

```sql
SELECT short_id, source_id, recorded_at FROM backfill_v27_ambiguous;
```

Each row tells the operator: "source `<source_id>` had a `筆記（<short_id>）` reference that we couldn't unambiguously resolve." The operator decides — typically by:

1. Checking which items share the prefix (`SELECT id, title FROM items_active WHERE id LIKE '<short_id>%' UNION SELECT id, title FROM items_vault WHERE id LIKE '<short_id>%'`).
2. Manually editing `items_active.content` to replace the ambiguous reference with `[[Correct Title]]`.
3. (Optional) Removing the resolved row from `backfill_v27_ambiguous`.

PR 4 ships the data; the operator UI for surfacing the ambiguous queue ships in a follow-up frontend PR alongside `/admin/recent-renames` and `/admin/title-collisions`.

## Why no bare-hex backfill?

The autoplan originally scoped "legacy `筆記（xxx）` + bare hex → `[[Title]]`" but bare hex matches in technical content (commit hashes, build IDs, file checksums) create unacceptable false-positive risk. The conservative cut keeps the migration trustworthy at the cost of leaving bare-hex references unrewritten — which is fine because they were never rendered as cross-references by the legacy renderer either.
