#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# error-summary.sh — Sparkle 錯誤摘要通知
#
# 掃描過去一小時的 journalctl 日誌，計算 pino ERROR (level 50) 和
# FATAL (level 60) 的數量，有錯誤時透過 LINE Push Message 發送摘要。
# 設計為 cron 排程使用，無需互動。
#
# 環境變數（從 .env 讀取）:
#   LINE_CHANNEL_ACCESS_TOKEN  LINE Bot access token (必要)
#   LINE_ADMIN_USER_ID         管理員 LINE userId (必要)
#
# 前置需求:
#   - jq (sudo apt install -y jq)
#   - systemd journalctl
#
# 建議 cron 設定:
#   0 * * * * /home/tim/sparkle/scripts/error-summary.sh 2>&1 | logger -t sparkle-errors
# ----------------------------------------------------------------------------
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPARKLE_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$SPARKLE_DIR/.env"

# ── Helpers ──────────────────────────────────────────────────────────────────
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

send_line_push() {
    local message="$1"
    curl -sf -X POST https://api.line.me/v2/bot/message/push \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN" \
        -d "$(printf '{"to":"%s","messages":[{"type":"text","text":"%s"}]}' \
            "$LINE_ADMIN_USER_ID" "$message")" \
        >/dev/null 2>&1
}

# ── Load .env ────────────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
    log "WARN: .env 不存在，跳過"
    exit 0
fi

# shellcheck source=/dev/null
set -a
source "$ENV_FILE"
set +a

# ── Pre-flight checks ───────────────────────────────────────────────────────
if [[ -z "${LINE_CHANNEL_ACCESS_TOKEN:-}" ]] || [[ -z "${LINE_ADMIN_USER_ID:-}" ]]; then
    exit 0
fi

if ! command -v jq &>/dev/null; then
    log "ERROR: jq 未安裝 — sudo apt install -y jq"
    exit 1
fi

# ── Scan journalctl logs ─────────────────────────────────────────────────────
# pino 輸出 JSON 到 stdout，journalctl 以 MESSAGE 欄位儲存
# 提取 MESSAGE 欄位中的 pino JSON，計算 error/fatal 數量
LOGS=$(journalctl -u sparkle --since "1 hour ago" -o json --no-pager 2>/dev/null || true)

if [[ -z "$LOGS" ]]; then
    exit 0
fi

ERROR_COUNT=0
FATAL_COUNT=0

while IFS= read -r line; do
    msg=$(echo "$line" | jq -r '.MESSAGE // empty' 2>/dev/null) || continue
    [[ -z "$msg" ]] && continue
    level=$(echo "$msg" | jq -r '.level // empty' 2>/dev/null) || continue
    case "$level" in
        50) ERROR_COUNT=$((ERROR_COUNT + 1)) ;;
        60) FATAL_COUNT=$((FATAL_COUNT + 1)) ;;
    esac
done <<< "$LOGS"

# ── Send summary if errors found ─────────────────────────────────────────────
TOTAL=$((ERROR_COUNT + FATAL_COUNT))

if [[ "$TOTAL" -gt 0 ]]; then
    log "發現 $TOTAL 筆錯誤 (ERROR: $ERROR_COUNT, FATAL: $FATAL_COUNT)"
    send_line_push "⚠️ Sparkle 錯誤摘要（過去 1 小時）\nERROR: ${ERROR_COUNT} 筆 | FATAL: ${FATAL_COUNT} 筆\n主機: $(hostname)\n時間: $(date '+%Y-%m-%d %H:%M:%S')" || \
        log "WARN: LINE 摘要通知發送失敗"
fi
