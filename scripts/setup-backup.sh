#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# setup-backup.sh — Sparkle 備份系統初始設定
#
# 互動式腳本，設定 restic 備份儲存庫並產生 cron 排程建議。
# 執行一次即可，後續由 cron + backup.sh 自動運作。
# ----------------------------------------------------------------------------
set -euo pipefail

# ── Colours & helpers ────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPARKLE_DIR="$(dirname "$SCRIPT_DIR")"
DEFAULT_REPO="$HOME/sparkle-backups"
DEFAULT_PASSWORD_FILE="$HOME/.sparkle-backup-password"
OFFSITE_REPO=""
OFFSITE_PASSWORD_FILE=""

# ── Step 1: Check sqlite3 ───────────────────────────────────────────────────
check_sqlite3() {
    if command -v sqlite3 &>/dev/null; then
        success "sqlite3 已安裝 ($(sqlite3 --version | head -1))"
    else
        error "sqlite3 未安裝。請執行: sudo apt install -y sqlite3"
        exit 1
    fi
}

# ── Step 2: Check / install restic ──────────────────────────────────────────
check_restic() {
    if command -v restic &>/dev/null; then
        success "restic 已安裝 ($(restic version))"
    else
        warn "restic 尚未安裝。"
        read -rp "是否要自動安裝 restic？ [Y/n] " ans
        ans="${ans:-Y}"
        if [[ "$ans" =~ ^[Yy]$ ]]; then
            info "正在安裝 restic ..."
            sudo apt update -qq && sudo apt install -y restic
            success "restic 安裝完成 ($(restic version))"
        else
            error "需要 restic 才能繼續。請手動安裝後重新執行此腳本。"
            exit 1
        fi
    fi
}

# ── Step 3: Configure repository ────────────────────────────────────────────
configure_repo() {
    echo ""
    info "=========================================="
    info " 設定備份儲存庫"
    info "=========================================="
    echo ""

    read -rp "備份儲存庫路徑 [$DEFAULT_REPO]: " repo_path
    repo_path="${repo_path:-$DEFAULT_REPO}"
    BACKUP_REPO="$repo_path"

    success "儲存庫路徑: $BACKUP_REPO"
}

# ── Step 4: Generate password ────────────────────────────────────────────────
setup_password() {
    echo ""
    read -rp "密碼檔路徑 [$DEFAULT_PASSWORD_FILE]: " pw_path
    pw_path="${pw_path:-$DEFAULT_PASSWORD_FILE}"
    PASSWORD_FILE="$pw_path"

    if [[ -f "$PASSWORD_FILE" ]]; then
        warn "密碼檔已存在: $PASSWORD_FILE"
        read -rp "是否使用現有密碼檔？ [Y/n] " reuse
        reuse="${reuse:-Y}"
        if [[ "$reuse" =~ ^[Yy]$ ]]; then
            success "使用現有密碼檔"
            return
        fi
    fi

    info "產生隨機密碼..."
    local password
    password="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
    echo "$password" > "$PASSWORD_FILE"
    chmod 600 "$PASSWORD_FILE"
    success "密碼已儲存至: $PASSWORD_FILE (權限 600)"
    echo ""
    warn "請妥善保管此密碼檔 — 遺失密碼將無法還原備份！"
}

# ── Step 5: Initialize restic repository ────────────────────────────────────
init_repo() {
    echo ""
    export RESTIC_REPOSITORY="$BACKUP_REPO"
    export RESTIC_PASSWORD_FILE="$PASSWORD_FILE"

    if restic snapshots &>/dev/null; then
        success "儲存庫已存在且可存取"
    else
        info "初始化 restic 儲存庫: $BACKUP_REPO ..."
        restic init
        success "儲存庫初始化完成"
    fi
}

# ── Step 6: Test backup ─────────────────────────────────────────────────────
test_backup() {
    echo ""
    read -rp "是否要立即執行一次測試備份？ [Y/n] " do_test
    do_test="${do_test:-Y}"

    if [[ "$do_test" =~ ^[Yy]$ ]]; then
        info "執行測試備份..."
        RESTIC_REPOSITORY="$BACKUP_REPO" \
        RESTIC_PASSWORD_FILE="$PASSWORD_FILE" \
        SPARKLE_DIR="$SPARKLE_DIR" \
            bash "$SCRIPT_DIR/backup.sh"
        success "測試備份完成！"
        echo ""
        info "目前快照："
        restic snapshots --tag sparkle
    fi
}

# ── Step 7: Configure offsite backup (optional) ─────────────────────────────
configure_offsite() {
    echo ""
    info "=========================================="
    info " 異地備份設定 (選填)"
    info "=========================================="
    echo ""
    info "異地備份會將快照複製到第二個 restic 儲存庫 (例如 D:\\ 磁碟)，"
    info "提供實體磁碟層級的冗餘保護。"
    echo ""

    read -rp "是否要設定異地備份？ [y/N] " setup_offsite
    setup_offsite="${setup_offsite:-N}"
    if [[ ! "$setup_offsite" =~ ^[Yy]$ ]]; then
        return 0
    fi

    local default_offsite="/mnt/d/sparkle-backups"
    read -rp "異地儲存庫路徑 [$default_offsite]: " offsite_path
    offsite_path="${offsite_path:-$default_offsite}"
    OFFSITE_REPO="$offsite_path"

    # Check mount point
    local mount_dir
    mount_dir="$(dirname "$offsite_path")"
    if [[ ! -d "$mount_dir" ]]; then
        warn "掛載點 $mount_dir 不存在 — 請確認磁碟已掛載後再初始化異地儲存庫"
        warn "掛載後可重新執行此腳本，或手動執行:"
        echo ""
        echo "  restic init --repo $offsite_path --password-file $PASSWORD_FILE \\"
        echo "    --copy-chunker-params --repo2 $BACKUP_REPO --password-file2 $PASSWORD_FILE"
        echo ""
        OFFSITE_REPO=""
        return 0
    fi

    # Password file (default: reuse primary)
    read -rp "異地密碼檔路徑 [$PASSWORD_FILE]: " offsite_pw
    offsite_pw="${offsite_pw:-$PASSWORD_FILE}"
    OFFSITE_PASSWORD_FILE="$offsite_pw"

    # Initialize offsite repo with --copy-chunker-params for dedup efficiency
    if RESTIC_REPOSITORY="$OFFSITE_REPO" RESTIC_PASSWORD_FILE="$OFFSITE_PASSWORD_FILE" \
        restic snapshots &>/dev/null; then
        success "異地儲存庫已存在且可存取"
    else
        info "初始化異地儲存庫 (使用相同分塊參數以優化去重效率)..."
        restic init \
            --repo "$OFFSITE_REPO" \
            --password-file "$OFFSITE_PASSWORD_FILE" \
            --copy-chunker-params \
            --repo2 "$BACKUP_REPO" \
            --password-file2 "$PASSWORD_FILE"
        success "異地儲存庫初始化完成: $OFFSITE_REPO"
    fi
}

# ── Step 8: Print summary ───────────────────────────────────────────────────
print_summary() {
    local backup_script="$SCRIPT_DIR/backup.sh"
    local cron_env="RESTIC_REPOSITORY=$BACKUP_REPO RESTIC_PASSWORD_FILE=$PASSWORD_FILE"

    if [[ -n "$OFFSITE_REPO" ]]; then
        cron_env="$cron_env RESTIC_OFFSITE_REPOSITORY=$OFFSITE_REPO"
        if [[ -n "$OFFSITE_PASSWORD_FILE" && "$OFFSITE_PASSWORD_FILE" != "$PASSWORD_FILE" ]]; then
            cron_env="$cron_env RESTIC_OFFSITE_PASSWORD_FILE=$OFFSITE_PASSWORD_FILE"
        fi
    fi

    local cron_line="0 3 * * * $cron_env $backup_script >> \$HOME/sparkle-backup.log 2>&1"

    echo ""
    echo "=========================================================="
    echo ""
    success "備份系統設定完成！"
    echo ""
    info "儲存庫:     $BACKUP_REPO"
    info "密碼檔:     $PASSWORD_FILE"
    info "備份腳本:   $backup_script"
    if [[ -n "$OFFSITE_REPO" ]]; then
        info "異地儲存庫: $OFFSITE_REPO"
        if [[ -n "$OFFSITE_PASSWORD_FILE" && "$OFFSITE_PASSWORD_FILE" != "$PASSWORD_FILE" ]]; then
            info "異地密碼檔: $OFFSITE_PASSWORD_FILE"
        else
            info "異地密碼檔: (同主要密碼檔)"
        fi
    fi
    echo ""
    echo -e "${GREEN}=========================================================="
    echo -e " 建議 cron 排程 (每日凌晨 3 點)"
    echo -e "==========================================================${NC}"
    echo ""
    echo "  $cron_line"
    echo ""
    info "安裝方式: crontab -e 後貼上上方整行"
    echo ""
    echo -e "${CYAN}=========================================================="
    echo -e " 還原方式"
    echo -e "==========================================================${NC}"
    echo ""
    echo "  # 列出可用快照"
    echo "  restic -r $BACKUP_REPO snapshots --tag sparkle"
    echo ""
    echo "  # 還原最新備份到暫存目錄"
    echo "  restic -r $BACKUP_REPO restore latest --tag sparkle --target /tmp/sparkle-restore"
    echo ""
    echo "  # 解壓縮並替換資料庫 (先停止服務)"
    echo "  sudo systemctl stop sparkle"
    echo "  gunzip /tmp/sparkle-restore/tmp/sparkle-backup.db.gz"
    echo "  cp /tmp/sparkle-restore/tmp/sparkle-backup.db $SPARKLE_DIR/data/todo.db"
    echo "  rm -f $SPARKLE_DIR/data/todo.db-wal $SPARKLE_DIR/data/todo.db-shm"
    echo "  chown \$(whoami) $SPARKLE_DIR/data/todo.db"
    echo "  sudo systemctl start sparkle"
    echo ""
    echo -e "${YELLOW}=========================================================="
    echo -e " 重要提醒"
    echo -e "==========================================================${NC}"
    echo ""
    warn "請備份密碼檔 ($PASSWORD_FILE) 到安全的地方。"
    warn "遺失密碼將無法還原任何備份！"
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
    echo ""
    echo "=========================================================="
    echo "  Sparkle 備份系統設定工具"
    echo "  使用 restic + sqlite3 進行自動化資料庫備份"
    echo "=========================================================="
    echo ""

    check_sqlite3
    check_restic
    configure_repo
    setup_password
    init_repo
    test_backup
    configure_offsite
    print_summary
}

main "$@"
