#!/usr/bin/env bash
# ROLLBACK migration 25 (drop items_vault.export_path).
#
# VALID ONLY FOR: VACUUM INTO backup files created by migration v25 itself
# (matching `~/sparkle-backups/todo.db.bak-pre-v25-*`). The backup is
# schema_version=24 — restoring it next to post-v25 code leaves the server
# unable to boot. The script refuses to proceed if the backup is not v24.
#
# CRITICAL: WAL/SHM sidecar files MUST be removed BEFORE the cp restore. WAL
# replay against the .bak file would corrupt it. The script does this for you;
# do not skip it if running steps manually.
#
# Procedure:
#   1. Pre-flight: backup file exists, schema_version matches, repo clean,
#      ROLLBACK_SHA looks like a hex sha.
#   2. systemctl stop sparkle
#   3. rm -f data/todo.db-{wal,shm}   # MANDATORY before cp
#   4. cp --preserve "$BACKUP" to the live DB
#   5. git checkout -B rollback-v25-$(date +%s) "$ROLLBACK_SHA" --
#   6. npm run build
#   7. systemctl start sparkle
#   8. curl /api/health
#
# Usage:
#   sudo ops/rollback-migration-25.sh <backup.db> <rollback-sha>
#
# Example:
#   sudo ops/rollback-migration-25.sh \
#     /home/tim/sparkle-backups/todo.db.bak-pre-v25-1714512345678 7b3a8ae

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <backup.db> <rollback-sha>" >&2
  exit 2
fi

BACKUP="$1"
ROLLBACK_SHA="$2"
DB_PATH="${DATABASE_URL:-/home/tim/sparkle/data/todo.db}"
REPO="${SPARKLE_REPO:-/home/tim/sparkle}"
HEALTH_URL="${SPARKLE_HEALTH_URL:-http://localhost:3000/api/health}"
EXPECTED_SCHEMA_VERSION="${EXPECTED_SCHEMA_VERSION:-24}"

# --- Pre-flight checks ---

if [[ ! -f "$BACKUP" ]]; then
  echo "❌ backup file not found: $BACKUP" >&2
  exit 1
fi

if ! [[ "$ROLLBACK_SHA" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  echo "❌ ROLLBACK_SHA must be 7–40 hex chars, got: $ROLLBACK_SHA" >&2
  exit 1
fi

# Verify backup schema_version matches expected. Post-v25 code cannot boot on a
# pre-v24 .db (vault_files reverse-lookup invariants assume v24+).
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "⚠️  sqlite3 CLI not found — cannot verify backup schema version" >&2
else
  BACKUP_VER=$(sqlite3 "$BACKUP" "SELECT version FROM schema_version" 2>/dev/null || echo "?")
  if [[ "$BACKUP_VER" != "$EXPECTED_SCHEMA_VERSION" ]]; then
    echo "❌ backup schema_version is $BACKUP_VER, expected $EXPECTED_SCHEMA_VERSION" >&2
    echo "   Pre-v24 backups need ops/rollback-migration-23.sh or further git checkout." >&2
    exit 1
  fi
fi

# Verify backup actually has the export_path column (sanity check — if it
# doesn't, we'd be restoring a post-v25 backup as a v25 rollback).
if command -v sqlite3 >/dev/null 2>&1; then
  HAS_COL=$(sqlite3 "$BACKUP" "SELECT COUNT(*) FROM pragma_table_info('items_vault') WHERE name='export_path'" 2>/dev/null || echo 0)
  if [[ "$HAS_COL" != "1" ]]; then
    echo "❌ backup is missing items_vault.export_path — not a valid v24 snapshot" >&2
    exit 1
  fi
fi

# Verify repo is clean — otherwise `git checkout` will fail or silently stash.
if ! git -C "$REPO" diff --quiet || ! git -C "$REPO" diff --cached --quiet; then
  echo "❌ $REPO has uncommitted changes. Commit or stash before rolling back." >&2
  git -C "$REPO" status --short >&2
  exit 1
fi

CURRENT_BRANCH=$(git -C "$REPO" rev-parse --abbrev-ref HEAD)
CURRENT_SHA=$(git -C "$REPO" rev-parse --short HEAD)
ROLLBACK_BRANCH="rollback-v25-$(date +%s)"

echo "→ current state: branch=$CURRENT_BRANCH sha=$CURRENT_SHA"
echo "→ will create branch '$ROLLBACK_BRANCH' pointing at $ROLLBACK_SHA"
echo "→ recovery: git -C $REPO checkout $CURRENT_BRANCH"
echo ""

# --- Execute rollback ---

# Capture the live DB's current owner before we stop the service. cp will
# inherit the running user's owner unless we restore it explicitly. Hardcoding
# `tim:tim` would fail on a recovery host without that user, so derive it.
ORIGINAL_OWNER=""
if [[ -f "$DB_PATH" ]]; then
  ORIGINAL_OWNER=$(stat -c '%U:%G' "$DB_PATH" 2>/dev/null || true)
fi

echo "→ stopping sparkle.service"
systemctl stop sparkle.service

# WAL/SHM cleanup is MANDATORY: WAL replay against the .bak file would replay
# v25-era writes onto a v24 schema, corrupting the restore.
echo "→ removing WAL/SHM sidecars"
rm -f "${DB_PATH}-shm" "${DB_PATH}-wal"

echo "→ restoring DB from $BACKUP → $DB_PATH"
cp --preserve=timestamps "$BACKUP" "$DB_PATH"
if [[ -n "$ORIGINAL_OWNER" ]]; then
  chown "$ORIGINAL_OWNER" "$DB_PATH"
fi

echo "→ checking out rollback sha $ROLLBACK_SHA on branch $ROLLBACK_BRANCH"
git -C "$REPO" fetch --all --tags --quiet
git -C "$REPO" checkout -B "$ROLLBACK_BRANCH" "$ROLLBACK_SHA" --

echo "→ rebuilding frontend"
cd "$REPO"
npm run build

echo "→ starting sparkle.service"
systemctl start sparkle.service

echo "→ waiting 3s for boot, then hitting $HEALTH_URL"
sleep 3
if curl -fsS "$HEALTH_URL" >/dev/null; then
  echo "🟢 rollback complete — health check passed"
  echo "   repo is on branch: $ROLLBACK_BRANCH"
  echo "   to return: git -C $REPO checkout $CURRENT_BRANCH"
else
  echo "🔴 health check failed — investigate journalctl -u sparkle.service" >&2
  exit 3
fi
