#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# health-monitor.sh — Sparkle 服務健康檢查
#
# 定期檢查 Sparkle 服務是否正常運作，異常時透過 LINE Push Message 通知管理員。
# 設計為 cron 排程使用，無需互動。
#
# 環境變數（從 .env 讀取）:
#   LINE_CHANNEL_ACCESS_TOKEN  LINE Bot access token (必要)
#   LINE_ADMIN_USER_ID         管理員 LINE userId (必要)
#   SPARKLE_HEALTH_URL         健康檢查 URL (預設: http://localhost:3000/api/health)
#
# 行為:
#   - 健康檢查失敗 → 發送告警（僅首次，用標記檔防止重複通知）
#   - 健康檢查恢復 → 發送恢復通知並清除標記檔
#   - 健康檢查正常 → 靜默退出
#
# 建議 cron 設定:
#   */5 * * * * /path/to/sparkle/scripts/health-monitor.sh 2>&1 | logger -t sparkle-health
# ----------------------------------------------------------------------------
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPARKLE_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$SPARKLE_DIR/.env"
ALERT_FLAG="/tmp/sparkle-health-alert-sent"
HEALTH_URL="${SPARKLE_HEALTH_URL:-http://localhost:3000/api/health}"

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
    # 缺少 LINE 設定，靜默退出（避免 cron 產生多餘輸出）
    exit 0
fi

# ── Health check ─────────────────────────────────────────────────────────────
if curl -sf --max-time 10 "$HEALTH_URL" >/dev/null 2>&1; then
    # 服務正常
    if [[ -f "$ALERT_FLAG" ]]; then
        log "服務已恢復，發送恢復通知"
        send_line_push "🟢 Sparkle 服務已恢復\n主機: $(hostname)\n時間: $(date '+%Y-%m-%d %H:%M:%S')" || \
            log "WARN: LINE 恢復通知發送失敗"
        rm -f "$ALERT_FLAG"
    fi
else
    # 服務異常
    if [[ ! -f "$ALERT_FLAG" ]]; then
        log "服務異常，發送告警通知"
        send_line_push "🔴 Sparkle 服務異常\n主機: $(hostname)\n時間: $(date '+%Y-%m-%d %H:%M:%S')" || \
            log "WARN: LINE 告警通知發送失敗"
        touch "$ALERT_FLAG"
    else
        log "服務仍然異常（已通知，跳過）"
    fi
fi
