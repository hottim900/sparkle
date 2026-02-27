#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# backup.sh — Sparkle 資料庫自動備份
#
# 使用 VACUUM INTO 建立壓縮一致性快照，gzip --rsyncable 壓縮後以 restic
# 進行版本化備份。設計為 cron 排程使用，無需互動。
#
# 環境變數:
#   RESTIC_REPOSITORY    restic 儲存庫路徑 (預設: ~/sparkle-backups)
#   RESTIC_PASSWORD_FILE restic 密碼檔路徑 (必要)
#   SPARKLE_DIR          專案根目錄 (預設: 腳本上層目錄)
#   DATABASE_URL         SQLite 資料庫路徑 (預設: $SPARKLE_DIR/data/todo.db)
#   HEALTHCHECK_URL      備份成功後 ping 的 URL (選填, e.g. healthchecks.io)
#
# 還原方式:
#   # 列出可用快照
#   restic -r ~/sparkle-backups snapshots --tag sparkle
#
#   # 還原最新備份到暫存目錄
#   restic -r ~/sparkle-backups restore latest --tag sparkle --target /tmp/sparkle-restore
#
#   # 解壓縮並替換資料庫 (先停止服務)
#   sudo systemctl stop sparkle
#   gunzip /tmp/sparkle-restore/tmp/sparkle-backup.db.gz
#   cp /tmp/sparkle-restore/tmp/sparkle-backup.db ~/sparkle/data/todo.db
#   rm -f ~/sparkle/data/todo.db-wal ~/sparkle/data/todo.db-shm
#   chown $(whoami) ~/sparkle/data/todo.db
#   sudo systemctl start sparkle
# ----------------------------------------------------------------------------
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPARKLE_DIR="${SPARKLE_DIR:-$(dirname "$SCRIPT_DIR")}"
DATABASE_URL="${DATABASE_URL:-$SPARKLE_DIR/data/todo.db}"
export RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-$HOME/sparkle-backups}"

SNAPSHOT_FILE="/tmp/sparkle-backup.db"
COMPRESSED_FILE="/tmp/sparkle-backup.db.gz"
LOCK_FILE="/tmp/sparkle-backup.lock"

# ── Helpers ──────────────────────────────────────────────────────────────────
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

cleanup() {
    rm -f "$SNAPSHOT_FILE" "$COMPRESSED_FILE"
}
trap cleanup EXIT

# ── Pre-flight checks ───────────────────────────────────────────────────────
if ! command -v sqlite3 &>/dev/null; then
    log "ERROR: sqlite3 未安裝"
    exit 1
fi

if ! command -v restic &>/dev/null; then
    log "ERROR: restic 未安裝 — 請執行 scripts/setup-backup.sh"
    exit 1
fi

if [[ -z "${RESTIC_PASSWORD_FILE:-}" ]]; then
    log "ERROR: RESTIC_PASSWORD_FILE 環境變數未設定"
    exit 1
fi

if [[ ! -f "$RESTIC_PASSWORD_FILE" ]]; then
    log "ERROR: 密碼檔不存在: $RESTIC_PASSWORD_FILE"
    exit 1
fi

if [[ ! -f "$DATABASE_URL" ]]; then
    log "ERROR: 資料庫不存在: $DATABASE_URL"
    exit 1
fi

# ── Prevent concurrent runs ─────────────────────────────────────────────────
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    log "ERROR: 另一個備份程序正在執行中"
    exit 1
fi

# ── Step 1: Database integrity check ────────────────────────────────────────
log "執行資料庫完整性檢查..."
integrity=$(sqlite3 "$DATABASE_URL" "PRAGMA integrity_check" 2>&1)
if [[ "$integrity" != "ok" ]]; then
    log "ERROR: 資料庫完整性檢查失敗:"
    log "$integrity"
    exit 1
fi
log "資料庫完整性檢查通過"

# ── Step 2: VACUUM INTO (compacted hot snapshot) ────────────────────────────
log "開始備份 — 建立 SQLite 快照 (VACUUM INTO)..."
rm -f "$SNAPSHOT_FILE" "$COMPRESSED_FILE"
sqlite3 "$DATABASE_URL" "VACUUM INTO '$SNAPSHOT_FILE'"
log "SQLite 快照完成 ($(du -h "$SNAPSHOT_FILE" | cut -f1))"

# ── Step 3: gzip --rsyncable (restic dedup friendly) ────────────────────────
log "壓縮快照 (gzip --rsyncable)..."
gzip --rsyncable "$SNAPSHOT_FILE"
log "壓縮完成 ($(du -h "$COMPRESSED_FILE" | cut -f1))"

# ── Step 4: Restic backup ───────────────────────────────────────────────────
log "上傳至 restic 儲存庫: $RESTIC_REPOSITORY"
restic backup "$COMPRESSED_FILE" \
    --tag db,sqlite,sparkle \
    --quiet

# ── Step 5: Apply retention policy ──────────────────────────────────────────
log "套用保留策略 (7日/4週/3月)..."
if ! restic forget --prune \
    --group-by host,tags \
    --keep-daily 7 \
    --keep-weekly 4 \
    --keep-monthly 3 \
    --tag sparkle \
    --quiet; then
    log "WARN: 保留策略清理失敗，備份已完成但舊快照未清理"
fi

# ── Step 6: Health check ping (optional) ────────────────────────────────────
if [[ -n "${HEALTHCHECK_URL:-}" ]]; then
    if ! curl -fsS --max-time 10 "$HEALTHCHECK_URL" >/dev/null 2>&1; then
        log "WARN: Health check ping 失敗 ($HEALTHCHECK_URL)，備份本身已成功"
    fi
fi

# ── Done ────────────────────────────────────────────────────────────────────
log "備份完成"
