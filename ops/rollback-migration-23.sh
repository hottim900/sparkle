#!/usr/bin/env bash
# ROLLBACK migration 23 (items → items_active + items_vault).
#
# VALID ONLY FOR: .db backups taken AFTER v23 was deployed (schema_version=23).
# NOT VALID FOR:  pre-v23 backups. A pre-v23 .db has the legacy `items` table;
#                 restoring it next to post-v23 code leaves the server unable
#                 to boot. The script refuses to proceed if the backup is not v23.
#
# Procedure:
#   1. Pre-flight: backup file exists, schema_version matches, repo has no
#      uncommitted changes, ROLLBACK_SHA looks like a hex sha.
#   2. systemctl stop sparkle
#   3. cp --preserve "$BACKUP" to the live DB (with .shm/.wal cleanup)
#   4. git checkout -B rollback-v23-$(date +%s) "$ROLLBACK_SHA" --
#      (named branch, not detached HEAD, so operator can inspect state)
#   5. npm run build
#   6. systemctl start sparkle
#   7. curl the /api/health endpoint
#
# Usage:
#   sudo ops/rollback-migration-23.sh <backup.db> <rollback-sha>
#
# Example:
#   sudo ops/rollback-migration-23.sh /home/tim/backups/todo-v23.db a4a32d7

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
EXPECTED_SCHEMA_VERSION="${EXPECTED_SCHEMA_VERSION:-23}"

# --- Pre-flight checks ---

if [[ ! -f "$BACKUP" ]]; then
  echo "❌ backup file not found: $BACKUP" >&2
  exit 1
fi

if ! [[ "$ROLLBACK_SHA" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  echo "❌ ROLLBACK_SHA must be 7–40 hex chars, got: $ROLLBACK_SHA" >&2
  exit 1
fi

# Verify backup schema_version matches expected. Post-v23 code cannot boot on a
# pre-v23 .db — the queries reference items_active which does not exist.
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "⚠️  sqlite3 CLI not found — cannot verify backup schema version" >&2
else
  BACKUP_VER=$(sqlite3 "$BACKUP" "SELECT version FROM schema_version" 2>/dev/null || echo "?")
  if [[ "$BACKUP_VER" != "$EXPECTED_SCHEMA_VERSION" ]]; then
    echo "❌ backup schema_version is $BACKUP_VER, expected $EXPECTED_SCHEMA_VERSION" >&2
    echo "   Pre-v23 backups require `git checkout` to a pre-v23 commit instead." >&2
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
ROLLBACK_BRANCH="rollback-v23-$(date +%s)"

echo "→ current state: branch=$CURRENT_BRANCH sha=$CURRENT_SHA"
echo "→ will create branch '$ROLLBACK_BRANCH' pointing at $ROLLBACK_SHA"
echo "→ recovery: git -C $REPO checkout $CURRENT_BRANCH"
echo ""

# --- Execute rollback ---

echo "→ stopping sparkle.service"
systemctl stop sparkle.service

echo "→ restoring DB from $BACKUP → $DB_PATH"
rm -f "${DB_PATH}-shm" "${DB_PATH}-wal"
cp --preserve=timestamps "$BACKUP" "$DB_PATH"
chown tim:tim "$DB_PATH"

echo "→ checking out rollback sha $ROLLBACK_SHA on branch $ROLLBACK_BRANCH"
git -C "$REPO" fetch --all --tags --quiet
# `-B` creates a named branch so HEAD is not detached. `--` disambiguates sha
# from any pathspec match.
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
