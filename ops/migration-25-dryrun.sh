#!/usr/bin/env bash
# Migration v25 dry-run — validates DROP COLUMN items_vault.export_path on a
# COPY of the production DB before the real migration is deployed.
#
# Usage:
#   ops/migration-25-dryrun.sh [source.db]
#
# Defaults to $DATABASE_URL or ./data/todo.db. Test DB lives at
# /tmp/sparkle-migration-test.db and is overwritten every run. The VACUUM INTO
# backup created by migrateV24toV25 is redirected to /tmp/sparkle-v25-dryrun-backups/
# (via SPARKLE_MIGRATION_BACKUP_DIR) so the operator's ~/sparkle-backups/ stays clean.
#
# Exits non-zero if any assertion fails. Run this before merging the v25 PR
# AND on the production host after `systemctl stop sparkle`, before starting
# the new version.

set -euo pipefail

SRC="${1:-${DATABASE_URL:-./data/todo.db}}"
DST="/tmp/sparkle-migration-test.db"
BACKUP_DIR="/tmp/sparkle-v25-dryrun-backups"

if [[ ! -f "$SRC" ]]; then
  echo "❌ source DB not found: $SRC" >&2
  exit 1
fi

echo "→ copying $SRC to $DST"
rm -f "$DST" "$DST-shm" "$DST-wal"
rm -rf "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
cp "$SRC" "$DST"

# Pre-migration snapshot
PRE_VERSION=$(sqlite3 "$DST" "SELECT version FROM schema_version")
PRE_VAULT=$(sqlite3 "$DST" "SELECT COUNT(*) FROM items_vault")
PRE_HAS_COL=$(sqlite3 "$DST" "SELECT COUNT(*) FROM pragma_table_info('items_vault') WHERE name='export_path'")
PRE_VAULT_FILES=$(sqlite3 "$DST" "SELECT COUNT(*) FROM vault_files")

echo "pre-migration: schema_v=$PRE_VERSION items_vault=$PRE_VAULT vault_files=$PRE_VAULT_FILES export_path_col=$PRE_HAS_COL"

if [[ "$PRE_VERSION" != "24" ]]; then
  echo "⚠️  source DB is at schema_version=$PRE_VERSION, not 24" >&2
  echo "   dry-run continues but real migration path may differ." >&2
fi

# Run migration via tsx
echo "→ running migrateV24toV25 on $DST (backups → $BACKUP_DIR)"
SPARKLE_MIGRATION_BACKUP_DIR="$BACKUP_DIR" DATABASE_URL="$DST" npx --yes tsx --eval "
import Database from 'better-sqlite3';
import { migrateV24toV25 } from '${PWD}/server/db/index.ts';
const sqlite = new Database('$DST');
sqlite.pragma('journal_mode = WAL');
migrateV24toV25(sqlite);
sqlite.close();
"

echo "→ verifying post-migration state"

POST_VERSION=$(sqlite3 "$DST" "SELECT version FROM schema_version")
POST_VAULT=$(sqlite3 "$DST" "SELECT COUNT(*) FROM items_vault")
POST_HAS_COL=$(sqlite3 "$DST" "SELECT COUNT(*) FROM pragma_table_info('items_vault') WHERE name='export_path'")
POST_VAULT_FILES=$(sqlite3 "$DST" "SELECT COUNT(*) FROM vault_files")
POST_FK_VAULT=$(sqlite3 "$DST" "PRAGMA foreign_key_check(items_vault)" | wc -l)
BACKUP_COUNT=$(find "$BACKUP_DIR" -name 'todo.db.bak-pre-v25-*' | wc -l)
BACKUP_FILE=$(find "$BACKUP_DIR" -name 'todo.db.bak-pre-v25-*' | head -1)
BACKUP_VER=""
BACKUP_HAS_COL=""
if [[ -n "$BACKUP_FILE" ]]; then
  BACKUP_VER=$(sqlite3 "$BACKUP_FILE" "SELECT version FROM schema_version" 2>/dev/null || echo "?")
  BACKUP_HAS_COL=$(sqlite3 "$BACKUP_FILE" "SELECT COUNT(*) FROM pragma_table_info('items_vault') WHERE name='export_path'" 2>/dev/null || echo "?")
fi

echo "post-migration: schema_v=$POST_VERSION items_vault=$POST_VAULT vault_files=$POST_VAULT_FILES export_path_col=$POST_HAS_COL"
echo "                fk_violations(items_vault)=$POST_FK_VAULT backups_created=$BACKUP_COUNT"
echo "                backup: ver=$BACKUP_VER export_path_col=$BACKUP_HAS_COL"

fail=0
check() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "❌ $label: expected $expected, got $actual"
    fail=1
  else
    echo "✅ $label = $actual"
  fi
}

check "schema_version" "$POST_VERSION" "25"
check "export_path column dropped" "$POST_HAS_COL" "0"
check "items_vault row count preserved" "$POST_VAULT" "$PRE_VAULT"
check "vault_files row count preserved" "$POST_VAULT_FILES" "$PRE_VAULT_FILES"
check "FK violations (items_vault)" "$POST_FK_VAULT" "0"
check "backup file created" "$BACKUP_COUNT" "1"
check "backup retains v24 schema" "$BACKUP_VER" "24"
check "backup retains export_path column" "$BACKUP_HAS_COL" "1"

# Idempotency: re-running the migration must be a no-op
echo "→ re-running migration (idempotency check)"
SPARKLE_MIGRATION_BACKUP_DIR="$BACKUP_DIR" DATABASE_URL="$DST" npx --yes tsx --eval "
import Database from 'better-sqlite3';
import { migrateV24toV25 } from '${PWD}/server/db/index.ts';
const sqlite = new Database('$DST');
sqlite.pragma('journal_mode = WAL');
migrateV24toV25(sqlite);
sqlite.close();
" 2>&1 | tail -5

POST2_VAULT=$(sqlite3 "$DST" "SELECT COUNT(*) FROM items_vault")
POST2_HAS_COL=$(sqlite3 "$DST" "SELECT COUNT(*) FROM pragma_table_info('items_vault') WHERE name='export_path'")
check "idempotent items_vault count" "$POST2_VAULT" "$POST_VAULT"
check "idempotent column drop" "$POST2_HAS_COL" "0"

if [[ "$fail" -eq 0 ]]; then
  echo ""
  echo "🟢 Migration 25 dry-run PASSED on $DST"
  exit 0
else
  echo ""
  echo "🔴 Migration 25 dry-run FAILED — investigate above failures before merging PR"
  exit 1
fi
