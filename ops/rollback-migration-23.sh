#!/usr/bin/env bash
# ROLLBACK migration 23 (items → items_active + items_vault).
#
# VALID ONLY FOR: .db backups taken AFTER v23 was deployed (the backup file
#                 already has items_active/items_vault tables).
# NOT VALID FOR:  pre-v23 backups. A pre-v23 .db has the legacy `items` table;
#                 restoring it next to post-v23 code leaves the server unable
#                 to boot. Pre-v23 backups require a concurrent
#                 `git checkout <pre-v23-commit>` so the code matches.
#
# Procedure implemented below:
#   1. systemctl stop sparkle
#   2. cp --preserve "$BACKUP" to the live DB (with .shm/.wal cleanup)
#   3. git checkout "$ROLLBACK_SHA"
#   4. npm run build
#   5. systemctl start sparkle
#   6. curl the /api/health endpoint
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

if [[ ! -f "$BACKUP" ]]; then
  echo "❌ backup file not found: $BACKUP" >&2
  exit 1
fi

echo "→ stopping sparkle.service"
systemctl stop sparkle.service

echo "→ restoring DB from $BACKUP → $DB_PATH"
rm -f "${DB_PATH}-shm" "${DB_PATH}-wal"
cp --preserve=timestamps "$BACKUP" "$DB_PATH"
chown tim:tim "$DB_PATH"

echo "→ checking out rollback sha $ROLLBACK_SHA"
git -C "$REPO" fetch --all --tags --quiet
git -C "$REPO" checkout "$ROLLBACK_SHA"

echo "→ rebuilding frontend"
cd "$REPO"
npm run build

echo "→ starting sparkle.service"
systemctl start sparkle.service

echo "→ waiting 3s for boot, then hitting $HEALTH_URL"
sleep 3
if curl -fsS "$HEALTH_URL" >/dev/null; then
  echo "🟢 rollback complete — health check passed"
else
  echo "🔴 health check failed — investigate journalctl -u sparkle.service" >&2
  exit 3
fi
