# Migration v24 — `vault_files.sparkle_id` backfill + reverse-lookup primary

Sparkle v1.4.4.0 promotes the **vault_files reverse-lookup** path from a watcher
fallback to the primary mechanism for resolving an exported note's vault path.
`items_vault.export_path` stays in the schema during the PR 2 dual-write window;
PR 3 (a follow-up release) drops it entirely.

The migration is **one-way and idempotent**. Schema does not change — only data
(`vault_files.sparkle_id`) is backfilled from on-disk frontmatter. v24 halts on
two specific error categories rather than silently completing with an
inconsistent index; recovery requires operator action via `npm run vault:audit`.

---

## 1. What changes (and what doesn't)

### Schema

**Unchanged.** No DDL runs in v24. The `items_vault.export_path` column stays.

### Data

For every `vault_files` row where `sparkle_id IS NULL`, v24 reads the on-disk
`.md` file's YAML frontmatter and, if a `sparkle_id` key is present, populates
the column. Files with no frontmatter or no `sparkle_id` key are skipped
silently — they are legitimate non-Sparkle notes.

### Code

- `server/lib/items.ts` — adds `getVaultPathBySparkleIdSync` and
  `resolveVaultPath` helpers used by every callsite that previously read
  `items_vault.export_path` directly.
- `server/lib/items.ts:listVaultItems` — both branches (tag-filter and non-tag)
  switch to a `LEFT JOIN vault_files ON vault_files.sparkle_id = items_vault.id`
  so the listing endpoint resolves live paths in the same SQL pass.
- `server/lib/export.ts:commitExportToVault` — also seeds `vault_files` inside
  the same transaction so reverse-lookup succeeds immediately after export
  (no 5-min scanner delay).
- `server/lib/export.ts:exportToObsidian` — pre-flights `vault_files` for the
  given `sparkle_id`. If a row exists but `items_vault` doesn't, the export is
  refused with `EXPORT_CRASH_RECOVERY` and the operator runs
  `npm run vault:reconcile`.
- `src/hooks/use-vault-path-by-sparkle-id.ts` — frontend hook
  (`@tanstack/react-query`) that resolves the live path; `null` data when
  no match (404 collapses to null, not an error).
- `src/components/announcement-provider.tsx` — single sr-only aria-live
  region; consumers call `useAnnouncement("vault 路徑已更新")` when the live
  path differs from the cached snapshot (rename was detected).

### systemd unit (separate operator step)

Pre-PR-2 unit had `Restart=always`. Post-PR-2 must have:

```
Restart=on-failure
RestartPreventExitStatus=78
SuccessExitStatus=78
```

so a deliberate `process.exit(78)` from a v24 halt is not looped by systemd.
Run `sudo bash scripts/migrate-systemd-unit.sh && sudo systemctl daemon-reload`
**before** deploying PR 2. Verify with:

```sh
systemctl cat sparkle.service | grep -E 'Restart|ExitStatus'
```

---

## 2. Pre-deploy steps

### 2.1 Backup (mandatory)

v23 backups are NOT v24-rollback-compatible (`ops/rollback-migration-23.sh`
hardcodes v23). Take a fresh backup before deploying PR 2:

```sh
sudo bash scripts/backup.sh
restic -r ~/sparkle-backups snapshots --tag sparkle | tail -3
```

### 2.2 Audit (recommended)

Surface orphans before they halt the migration on first start:

```sh
npm run vault:audit
# → produces scripts/vault-audit-report.json
# → exits non-zero if any items_vault row has no vault_files reverse-lookup
```

If orphans exist, the CLI prompts interactively (archive / re-audit / skip)
or accepts `--batch=archive-all` / `--batch=skip-all`. Run
`npm run vault:reconcile -- --apply-from=scripts/vault-audit-report.json`
afterwards to apply archives.

### 2.3 systemd unit migration

```sh
sudo bash scripts/migrate-systemd-unit.sh
sudo systemctl daemon-reload
```

### 2.4 Single-process pre-flight (required at deploy time)

```sh
sudo systemctl stop sparkle
sleep 3
pgrep -fc 'tsx server/index.ts' | grep -q '^0$' || { echo "Old process still running"; exit 1; }
```

---

## 3. Migration internals

### Two-phase, async-then-sync

```
PHASE 1 (sync I/O, outside transaction)
  for each vault_files row with sparkle_id IS NULL:
    try readFileSync(.md), extractSparkleId(content)
    accumulate `updates: Map<path, sparkle_id>`
    accumulate `unparseable: Array<{path, reason}>` for filesystem errors

  if unparseable.length > 0 → throw V24HaltError(unparseable)

PHASE 2 (sync transaction)
  for each (path, sparkle_id) in updates:
    UPDATE vault_files SET sparkle_id = ? WHERE path = ?

  orphans := items_vault rows with no vault_files match
  if orphans.length > 0 → throw V24HaltError(orphans)  # rolls back tx

  setSchemaVersion(24)
  COMMIT
```

The PHASE 1 / PHASE 2 split is required because better-sqlite3's transactions
wrap a synchronous function. ENOENT (file deleted between scanner-index and
migration) is silently tolerated. Empty / no-frontmatter `.md` files are NOT
errors — they are the legitimate non-Sparkle case.

`setSchemaVersion(24)` lives inside the transaction so a halt rolls back both
backfill AND version bump. v24 is therefore replay-safe.

---

## 4. Halt categories

### 4.1 `[migration_v24_halted_unparseable]`

Surfaced by PHASE 1 when one or more `.md` files threw on `readFileSync` for
a reason other than ENOENT (permission, EISDIR, malformed YAML if extracted
inside extract).

**Halt log shape** (pino structured):

```json
{
  "event": "migration_v24_halted_unparseable",
  "count": 2,
  "files": [{ "path": "0_Inbox/bad.md", "reason": "EACCES: permission denied" }],
  "error": "2 個 .md 檔案無法讀取或 frontmatter 格式錯誤。…",
  "error_en": "2 .md files have unreadable frontmatter or filesystem errors. …",
  "docs": "see docs/migration-v24.md#troubleshooting-unparseable-frontmatter"
}
```

### Troubleshooting unparseable frontmatter

```sh
journalctl -u sparkle --since "5 minutes ago" | grep migration_v24_halted_unparseable
# Inspect each `path` in the `files` array. Decisions:
#   - file unreadable due to permissions → fix ownership / chmod
#   - file is symlink to elsewhere → resolve the target
#   - file is corrupt → move it out of the vault and let the scanner re-discover
# Once resolved:
sudo systemctl restart sparkle
# v24 re-runs idempotently from a clean state.
```

### 4.2 `[migration_v24_halted_orphans]`

Surfaced by PHASE 2 when `items_vault` carries a row whose `id` does not match
any `vault_files.sparkle_id` after backfill. This is the signature of a
historic state where Sparkle's metadata mirror diverged from disk.

**Halt log shape**:

```json
{
  "event": "migration_v24_halted_orphans",
  "count": 3,
  "ids": ["aaaa-…", "bbbb-…"],
  "error": "3 個 items_vault 找不到對應 vault_files。執行 npm run vault:audit …",
  "error_en": "3 items_vault rows have no vault_files match. Run `npm run vault:audit`…",
  "docs": "see docs/migration-v24.md#when-v24-halts-on-orphans"
}
```

### When v24 halts on orphans

```sh
journalctl -u sparkle --since "5 minutes ago" | grep migration_v24_halted_orphans
# Decode the `ids` array — these are items_vault rows with no vault_files match.
# Run the audit CLI to choose archive / re-audit / skip per row:
npm run vault:audit
# Apply decisions:
npm run vault:reconcile -- --apply-from=scripts/vault-audit-report.json
# Restart:
sudo systemctl restart sparkle
```

The transaction rolled back, so `schema_version` stays at 23 between
operator runs. `setSchemaVersion(24)` only happens after both halt
categories return zero. v24 is replay-safe.

---

## 5. Rollback

v24 makes only data changes (UPDATE-only on `vault_files.sparkle_id` from
NULL to a real value). The rollback path is the v23-compatible backup taken
before deploy:

```sh
sudo systemctl stop sparkle
restic -r ~/sparkle-backups restore latest --tag sparkle --target /tmp/sparkle-restore
gunzip /tmp/sparkle-restore/tmp/sparkle-backup.db.gz
cp /tmp/sparkle-restore/tmp/sparkle-backup.db ~/sparkle/data/todo.db
rm -f ~/sparkle/data/todo.db-wal ~/sparkle/data/todo.db-shm   # CRITICAL
chown $(whoami) ~/sparkle/data/todo.db
git checkout v1.4.3.0       # pre-v24 code
sudo systemctl start sparkle
```

The `rm -f data/todo.db-{wal,shm}` step is mandatory: WAL frames in those
sidecars predate the restore and would replay back into a corrupt state.

---

## 6. Post-deploy verification

```sh
# Schema bumped
sqlite3 ~/sparkle/data/todo.db "SELECT version FROM schema_version"
# → 24

# Reverse-lookup hits every items_vault row
npm run vault:probe
# → exit 0; "✅ reverse-lookup hit: N / N"

# Fallback hit count = 0 over the soak window
journalctl -u sparkle --since "1 hour ago" | grep vault_fallback_hit | wc -l
# → 0

# Reconnect Claude.ai connector once after deploy:
#   https://claude.ai/settings → Sparkle → Reconnect
#   (the MCP server signs JWTs from the migrated DB; one fresh handshake
#   ensures the client uses the new schema's contract)
```

---

## 7. Notes for operators

- The 5-minute scanner cycle still picks up Obsidian rename/move events.
  Reverse-lookup serves the previously-indexed path until the next scan
  lands; the UI's `useVaultPathBySparkleId` hook caches results for 60s
  with `keepPreviousData`, so a stale link stays clickable during the
  transition.
- **iOS Obsidian Sync conflict files** (`note (sync conflict 2026-04-30).md`)
  may carry the same `sparkle_id` frontmatter as the original. The scanner's
  `idx_vault_files_sparkle_id` UNIQUE partial index will reject the conflict
  copy, audit-log the duplicate to `quality/duplicate-sparkle-id.json`, and
  index it without a sparkle link. Inspect periodically.
