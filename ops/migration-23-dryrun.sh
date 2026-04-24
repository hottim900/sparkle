#!/usr/bin/env bash
# Migration v23 dry-run — validates items → items_active + items_vault split on
# a COPY of the production DB before the real migration is deployed.
#
# Usage:
#   ops/migration-23-dryrun.sh [source.db]
#
# Defaults to $DATABASE_URL or ./data/todo.db. Test DB lives at
# /tmp/sparkle-migration-test.db and is overwritten every run.
#
# Exits non-zero if any assertion fails. Run this before merging the v23 PR and
# again on the production host after `systemctl stop sparkle`, before starting
# the new version.

set -euo pipefail

SRC="${1:-${DATABASE_URL:-./data/todo.db}}"
DST="/tmp/sparkle-migration-test.db"

if [[ ! -f "$SRC" ]]; then
  echo "❌ source DB not found: $SRC" >&2
  exit 1
fi

echo "→ copying $SRC to $DST"
rm -f "$DST" "$DST-shm" "$DST-wal"
cp "$SRC" "$DST"

# Pre-migration snapshot for comparison
PRE_TOTAL=$(sqlite3 "$DST" "SELECT COUNT(*) FROM items")
PRE_EXPORTED=$(sqlite3 "$DST" "SELECT COUNT(*) FROM items WHERE status = 'exported'")
PRE_ACTIVE=$((PRE_TOTAL - PRE_EXPORTED))
PRE_SHARES=$(sqlite3 "$DST" "SELECT COUNT(*) FROM share_tokens")
PRE_VIEWED=$(sqlite3 "$DST" "SELECT COUNT(*) FROM items WHERE viewed_at IS NOT NULL AND status != 'exported'")
PRE_VERSION=$(sqlite3 "$DST" "SELECT version FROM schema_version")

echo "pre-migration: total=$PRE_TOTAL active=$PRE_ACTIVE exported=$PRE_EXPORTED shares=$PRE_SHARES viewed=$PRE_VIEWED schema_v=$PRE_VERSION"

if [[ "$PRE_VERSION" != "22" ]]; then
  echo "⚠️  source DB is at schema_version=$PRE_VERSION, not 22" >&2
  echo "   dry-run continues but real migration path may differ." >&2
fi

# Run migration via tsx (same entrypoint used by the server, so we exercise
# the exact migrateV22toV23 code path rather than duplicating SQL here).
echo "→ running migrateV22toV23 on $DST"
DATABASE_URL="$DST" npx --yes tsx --eval "
import Database from 'better-sqlite3';
import { migrateV22toV23 } from '${PWD}/server/db/index.ts';
import { setupFTS } from '${PWD}/server/db/fts.ts';
const sqlite = new Database('$DST');
sqlite.pragma('journal_mode = WAL');
migrateV22toV23(sqlite);
setupFTS(sqlite);
sqlite.close();
"

echo "→ verifying post-migration state"

POST_VERSION=$(sqlite3 "$DST" "SELECT version FROM schema_version")
POST_ACTIVE=$(sqlite3 "$DST" "SELECT COUNT(*) FROM items_active")
POST_VAULT=$(sqlite3 "$DST" "SELECT COUNT(*) FROM items_vault")
POST_VIEWED=$(sqlite3 "$DST" "SELECT COUNT(*) FROM items_active WHERE viewed_at IS NOT NULL")
POST_SNIPPET_MAX=$(sqlite3 "$DST" "SELECT COALESCE(MAX(LENGTH(content_snippet)), 0) FROM items_vault")
POST_SNIPPET_OVERLONG=$(sqlite3 "$DST" "SELECT COUNT(*) FROM items_vault WHERE LENGTH(content_snippet) > 500")
POST_ITEMS_EXISTS=$(sqlite3 "$DST" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='items'")
POST_ACTIVE_FTS=$(sqlite3 "$DST" "SELECT COUNT(*) FROM items_active_fts")
POST_FK_ACTIVE=$(sqlite3 "$DST" "PRAGMA foreign_key_check(items_active)" | wc -l)
POST_FK_VAULT=$(sqlite3 "$DST" "PRAGMA foreign_key_check(items_vault)" | wc -l)
POST_SHARES=$(sqlite3 "$DST" "SELECT COUNT(*) FROM share_tokens")

echo "post-migration: active=$POST_ACTIVE vault=$POST_VAULT viewed=$POST_VIEWED shares=$POST_SHARES schema_v=$POST_VERSION"
echo "                snippet_max=$POST_SNIPPET_MAX snippet_overlong=$POST_SNIPPET_OVERLONG"
echo "                items_table=$POST_ITEMS_EXISTS (expect 0) active_fts=$POST_ACTIVE_FTS"
echo "                fk_violations: active=$POST_FK_ACTIVE vault=$POST_FK_VAULT"

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

check "schema_version" "$POST_VERSION" "23"
check "items_active count" "$POST_ACTIVE" "$PRE_ACTIVE"
check "items_vault count" "$POST_VAULT" "$PRE_EXPORTED"
check "items table removed" "$POST_ITEMS_EXISTS" "0"
check "content_snippet overflow" "$POST_SNIPPET_OVERLONG" "0"
check "FK violations (items_active)" "$POST_FK_ACTIVE" "0"
check "FK violations (items_vault)" "$POST_FK_VAULT" "0"

# viewed_at preservation (R4-BLOCKER-1 regression guard)
if [[ "$PRE_VIEWED" -gt 0 ]]; then
  if [[ "$POST_VIEWED" != "$PRE_VIEWED" ]]; then
    echo "❌ viewed_at lost: pre=$PRE_VIEWED post=$POST_VIEWED"
    fail=1
  else
    echo "✅ viewed_at preserved ($POST_VIEWED rows)"
  fi
fi

# FTS searchable
FTS_SAMPLE=$(sqlite3 "$DST" "SELECT rowid FROM items_active_fts LIMIT 1" || echo "")
if [[ "$POST_ACTIVE" -gt 0 && -z "$FTS_SAMPLE" ]]; then
  echo "❌ items_active_fts not populated"
  fail=1
else
  echo "✅ items_active_fts has rows"
fi

# Idempotency: running the migration again must be a no-op
echo "→ re-running migration (idempotency check)"
DATABASE_URL="$DST" npx --yes tsx --eval "
import Database from 'better-sqlite3';
import { migrateV22toV23 } from '${PWD}/server/db/index.ts';
const sqlite = new Database('$DST');
sqlite.pragma('journal_mode = WAL');
migrateV22toV23(sqlite);
sqlite.close();
" 2>&1 | tail -5

POST2_ACTIVE=$(sqlite3 "$DST" "SELECT COUNT(*) FROM items_active")
POST2_VAULT=$(sqlite3 "$DST" "SELECT COUNT(*) FROM items_vault")
check "idempotent items_active" "$POST2_ACTIVE" "$POST_ACTIVE"
check "idempotent items_vault" "$POST2_VAULT" "$POST_VAULT"

if [[ "$fail" -eq 0 ]]; then
  echo ""
  echo "🟢 Migration 23 dry-run PASSED on $DST"
  exit 0
else
  echo ""
  echo "🔴 Migration 23 dry-run FAILED — investigate above failures before merging PR"
  exit 1
fi
