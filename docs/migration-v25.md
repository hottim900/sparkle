# Migration v25 — drop `items_vault.export_path`

Sparkle v1.4.5.0 completes the vault path consolidation that started in v24.
`vault_files.sparkle_id` reverse-lookup is now the **sole** source of truth
for an exported note's vault path; the `items_vault.export_path` snapshot
column is removed entirely.

The migration is **one-way and irreversible-without-backup**. v25 takes a
WAL-consistent snapshot via `VACUUM INTO` BEFORE running the `DROP COLUMN`,
so an operator with disk access can roll back via `ops/rollback-migration-25.sh`.

---

## 1. What changes (and what doesn't)

### Schema

`items_vault` loses the `export_path TEXT` column.

```diff
 CREATE TABLE items_vault (
   id TEXT PRIMARY KEY,
   title TEXT NOT NULL,
   category_id TEXT,
   tags TEXT NOT NULL DEFAULT '[]',
   aliases TEXT NOT NULL DEFAULT '[]',
   source TEXT,
   origin TEXT,
-  export_path TEXT,
   exported_at TEXT NOT NULL,
   created TEXT NOT NULL,
   is_private INTEGER NOT NULL DEFAULT 0,
   content_snippet TEXT NOT NULL DEFAULT '',
   FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
 );
```

No CHECK constraint, partial index, or FK references `export_path`. SQLite
3.35+ supports `ALTER TABLE ... DROP COLUMN`; better-sqlite3 12.x bundles 3.46+,
well above the threshold.

### Data

Row count and content are unchanged on every other column. The vault path
each row used to carry is now reconstructed at read time from
`vault_files.sparkle_id = items_vault.id` — v24 already populated this index
(both via migration backfill and via the post-export `commitExportToVault`
seed), so reads see the same path that `export_path` previously held, but
**live** (a vault rename/move surfaces immediately, no 60s watcher delay).

### Code

The follow-on cleanup that lands in the same PR:

- `server/lib/vault-watcher.ts` (140 LOC) — **deleted**. Reverse-lookup is
  the primary path; the 60s self-heal watcher has nothing left to heal.
- `server/lib/vault-backfill.ts` (100 LOC) — **deleted**. Migration v24
  did the one-shot backfill; the recurring loop has no purpose post-v25.
- `server/lib/frontmatter.ts` — **new**. The `extractSparkleId` helper
  (previously inside `vault-backfill.ts`) moves here; migration v24 + the
  scanner + `vault:audit` CLI all import it from the new path.
- `server/lib/items.ts:resolveVaultPath` — **deleted**. The `lookup` /
  `fallback` distinction is moot; callsites use `getVaultPathBySparkleIdSync`
  directly.
- `server/lib/items.ts:deleteVaultItem` — return shape is now
  `{ id, vault_path: string | null }` (queried via reverse-lookup inside
  the same transaction) instead of `{ id, export_path }`.
- `vaultReadonlyPayload` — `vault_path_source` narrows from
  `"lookup" | "fallback" | null` to `"lookup" | null`.

---

## 2. Pre-flight (operator)

Before deploying v25:

1. **Verify single-process state**:

   ```bash
   sudo systemctl stop sparkle
   sleep 3
   pgrep -fc 'tsx server/index.ts' | grep -q '^0$' || { echo "Old process still running"; exit 1; }
   ```

   Concurrent processes during `runMigrations` would each independently
   attempt v25, creating duplicate backup files; the second `DROP COLUMN`
   would no-op (idempotency guard) but the operator history is harder to
   read. Single-process is the cleaner guarantee.

2. **Run the dry-run on a copy**:

   ```bash
   ops/migration-25-dryrun.sh
   ```

   This copies the current DB to `/tmp/sparkle-migration-test.db`, runs
   `migrateV24toV25`, and verifies row counts + schema state. Failures here
   block the live migration.

3. **Confirm `~/sparkle-backups/` has space** (v25 takes a `VACUUM INTO`
   snapshot of the live DB; the script needs at least 1.2× the live DB
   size free at the backup target):

   ```bash
   df -h ~/sparkle-backups
   ls -la ~/sparkle-backups
   ```

4. **Deploy + restart**:

   ```bash
   git pull --ff-only
   npm install --omit=dev
   npm run build
   sudo systemctl start sparkle
   journalctl -u sparkle -n 50 --since "10 seconds ago" | grep -E '(migration|sparkle.+started)'
   ```

5. **Reconnect Claude.ai connector** if you use one — the MCP tool surface
   for VAULT_READONLY responses changed shape (`vault_path_source` no longer
   takes `"fallback"`). The connector needs a single re-auth tap to pick up
   the updated tool descriptions; data and credentials are preserved. (Same
   as the v23 → v24 advice in `docs/migration-v23.md`.)

---

## 3. Halt categories

v25 throws `V25HaltError` (caught by `createDb`, routed through
`haltAndExit` → `process.exit(78)`) on two backup-side failures. The 78
exit code pairs with `RestartPreventExitStatus=78` in
`scripts/systemd/sparkle.service`, so systemd does not restart-loop the
halted process.

### `migration_v25_halted_no_disk`

The pre-flight `statfsSync` reports less than 1.2× the live DB size free at
`~/sparkle-backups/` (or whatever `SPARKLE_MIGRATION_BACKUP_DIR` points at).
Operator action: free up space, then restart sparkle. The migration
re-runs idempotently on next boot.

### `migration_v25_halted_backup_failed`

`mkdirSync` couldn't create the backup directory, OR `VACUUM INTO` threw
(permission denied, IO error, locked target). Operator action: inspect the
bilingual `error` field for the underlying cause, fix it (typically a
`chown` / `chmod` of `~/sparkle-backups/`), then restart sparkle.

---

## 4. Rollback

> **CRITICAL — WAL/SHM cleanup is mandatory.** If you skip the
> `rm -f data/todo.db-wal data/todo.db-shm` step, SQLite will replay v25-era
> writes onto the v24 backup file and corrupt the restore. The
> `ops/rollback-migration-25.sh` script does this for you; do not skip it
> if you run the steps manually.

1. Stop the service:

   ```bash
   sudo systemctl stop sparkle
   ```

2. Remove WAL + SHM sidecars (mandatory):

   ```bash
   rm -f /home/tim/sparkle/data/todo.db-wal /home/tim/sparkle/data/todo.db-shm
   ```

3. Restore the backup:

   ```bash
   cp --preserve=timestamps \
     ~/sparkle-backups/todo.db.bak-pre-v25-<timestamp> \
     /home/tim/sparkle/data/todo.db
   ```

4. Check out the pre-v25 commit:

   ```bash
   cd /home/tim/sparkle
   git checkout -B rollback-v25-$(date +%s) <pre-v25-sha> --
   npm run build
   ```

5. Start the service:

   ```bash
   sudo systemctl start sparkle
   sleep 3
   curl -fsS http://localhost:3000/api/health
   ```

The all-in-one script:

```bash
sudo ops/rollback-migration-25.sh \
  ~/sparkle-backups/todo.db.bak-pre-v25-1714512345678 \
  7b3a8ae
```

The script enforces all four pre-flight checks above (backup is v24,
backup retains the `export_path` column, repo is clean, rollback sha
looks like a hex sha) and refuses to proceed otherwise.

---

## 5. Backup retention

`migrateV24toV25` writes one backup per run to `~/sparkle-backups/`. The
restic-managed daily backups in the same directory (`scripts/backup.sh`)
are unaffected — restic dedups on content hash, so the new files cost
roughly the size of one DB on disk regardless of how many migrations have
run. There is no automatic cleanup of the `todo.db.bak-pre-v25-*` files;
delete them manually after a few weeks of post-v25 stability.

---

## 6. Verification (post-deploy)

```bash
# schema_version
sqlite3 /home/tim/sparkle/data/todo.db "SELECT version FROM schema_version"
# expect: 25

# export_path column gone
sqlite3 /home/tim/sparkle/data/todo.db "PRAGMA table_info(items_vault)" | grep -c export_path
# expect: 0

# vault rows still there
sqlite3 /home/tim/sparkle/data/todo.db "SELECT COUNT(*) FROM items_vault"
# expect: same number as before

# reverse-lookup endpoint returns paths
curl -fsS "http://localhost:3000/api/vault/by-sparkle-id/<some-vault-id>"
# expect: { "path": "...", "id": "..." }

# git grep clean
cd /home/tim/sparkle
git grep export_path -- '*.ts' '*.tsx' | grep -v 'migration-v[12][0-3]'
# expect: only post-v25 doc strings (server/lib/item-enrichment.ts comment,
#         server/lib/vault-errors.ts comment, src/hooks/use-vault-path-by-sparkle-id.ts comment,
#         server/db/index.ts migration history + v25 migration code)
```

If any of these diverge, see §3 (halt categories) and §4 (rollback).
