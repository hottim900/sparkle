#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# setup-cloudflared.sh
#
# Interactive script to set up a Cloudflare Tunnel that exposes the full
# Sparkle service to the internet. Access control is handled by Cloudflare
# Access — the /api/webhook/* path is left public for LINE Bot, while all
# other paths require authentication via CF Access policy.
#
# Designed for Debian / Ubuntu (including WSL).
# ----------------------------------------------------------------------------
set -euo pipefail

# ── Colours & helpers ────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Colour

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ── Constants ────────────────────────────────────────────────────────────────
TUNNEL_NAME="sparkle"
CLOUDFLARED_DIR="$HOME/.cloudflared"
CONFIG_FILE="$CLOUDFLARED_DIR/${TUNNEL_NAME}-config.yml"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_FILE="$SCRIPT_DIR/cloudflared-config.yml.template"

# ── Step 1: Check / Install cloudflared ──────────────────────────────────────
install_cloudflared() {
    info "正在安裝 cloudflared ..."

    local arch
    arch="$(dpkg --print-architecture 2>/dev/null || echo amd64)"

    local deb_url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb"
    local tmp_deb
    tmp_deb="$(mktemp /tmp/cloudflared-XXXXXX.deb)"

    info "下載中: $deb_url"
    curl -fsSL -o "$tmp_deb" "$deb_url"
    sudo dpkg -i "$tmp_deb"
    rm -f "$tmp_deb"
    success "cloudflared 安裝完成。"
}

check_cloudflared() {
    if command -v cloudflared &>/dev/null; then
        local ver
        ver="$(cloudflared --version 2>&1 | head -1)"
        success "cloudflared 已安裝 ($ver)"
    else
        warn "cloudflared 尚未安裝。"
        read -rp "是否要自動安裝 cloudflared？ [Y/n] " ans
        ans="${ans:-Y}"
        if [[ "$ans" =~ ^[Yy]$ ]]; then
            install_cloudflared
        else
            error "需要 cloudflared 才能繼續。請手動安裝後重新執行此腳本。"
            exit 1
        fi
    fi
}

# ── Step 2: Check Cloudflare login ───────────────────────────────────────────
check_login() {
    info "檢查 Cloudflare 登入狀態 ..."

    if cloudflared tunnel list &>/dev/null; then
        success "已登入 Cloudflare。"
    else
        warn "尚未登入 Cloudflare。"
        info "即將開啟瀏覽器進行登入授權 ..."
        cloudflared tunnel login
        success "Cloudflare 登入完成。"
    fi
}

# ── Step 3: Create or reuse named tunnel ─────────────────────────────────────
get_or_create_tunnel() {
    info "檢查是否已有名為 '$TUNNEL_NAME' 的 Tunnel ..."

    local tunnel_id
    tunnel_id="$(cloudflared tunnel list --output json 2>/dev/null \
        | python3 -c "
import sys, json
tunnels = json.load(sys.stdin)
for t in tunnels:
    if t['name'] == '$TUNNEL_NAME' and 'deleted_at' not in t:
        print(t['id'])
        break
" 2>/dev/null || true)"

    if [[ -n "$tunnel_id" ]]; then
        success "找到現有 Tunnel: $TUNNEL_NAME (ID: $tunnel_id)"
    else
        info "建立新 Tunnel: $TUNNEL_NAME ..."
        cloudflared tunnel create "$TUNNEL_NAME"

        tunnel_id="$(cloudflared tunnel list --output json 2>/dev/null \
            | python3 -c "
import sys, json
tunnels = json.load(sys.stdin)
for t in tunnels:
    if t['name'] == '$TUNNEL_NAME' and 'deleted_at' not in t:
        print(t['id'])
        break
")"
        success "Tunnel 建立完成 (ID: $tunnel_id)"
    fi

    TUNNEL_ID="$tunnel_id"
}

# ── Step 4: Ask about domain setup ───────────────────────────────────────────
configure_hostname() {
    echo ""
    info "=========================================="
    info " 設定 Tunnel 對外主機名稱"
    info "=========================================="
    echo ""
    echo "  你可以選擇："
    echo "    1) 使用自己的網域 (例如: webhook.example.com)"
    echo "       - 需要該網域已加入 Cloudflare DNS"
    echo "    2) 使用 Cloudflare 免費提供的 cfargotunnel.com 位址"
    echo "       - 格式為: ${TUNNEL_ID}.cfargotunnel.com"
    echo "       - 不需要自己的網域"
    echo ""

    read -rp "你有自己的網域嗎？ [y/N] " has_domain
    has_domain="${has_domain:-N}"

    if [[ "$has_domain" =~ ^[Yy]$ ]]; then
        read -rp "請輸入你要使用的主機名稱 (例如 webhook.example.com): " custom_hostname

        if [[ -z "$custom_hostname" ]]; then
            error "主機名稱不可為空。"
            exit 1
        fi

        HOSTNAME="$custom_hostname"

        info "建立 DNS 路由: $HOSTNAME -> Tunnel $TUNNEL_NAME ..."
        cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME" 2>/dev/null || {
            warn "DNS 路由可能已存在，或需要手動設定。"
            warn "請確認 Cloudflare DNS 中有一筆 CNAME 記錄："
            warn "  $HOSTNAME -> ${TUNNEL_ID}.cfargotunnel.com"
        }
    else
        HOSTNAME="${TUNNEL_ID}.cfargotunnel.com"
        info "將使用 cfargotunnel.com 位址。"
    fi

    success "Tunnel 主機名稱: $HOSTNAME"
}

# ── Step 5: Generate config.yml ──────────────────────────────────────────────
generate_config() {
    local creds_file="$CLOUDFLARED_DIR/${TUNNEL_ID}.json"

    info "產生設定檔: $CONFIG_FILE ..."

    if [[ ! -f "$creds_file" ]]; then
        warn "找不到憑證檔案: $creds_file"
        warn "請確認 Tunnel 建立是否成功。"
    fi

    # Back up existing config
    if [[ -f "$CONFIG_FILE" ]]; then
        local backup="${CONFIG_FILE}.bak.$(date +%Y%m%d%H%M%S)"
        warn "設定檔已存在，備份至: $backup"
        cp "$CONFIG_FILE" "$backup"
    fi

    mkdir -p "$CLOUDFLARED_DIR"

    # Generate from template if available, otherwise write directly
    if [[ -f "$TEMPLATE_FILE" ]]; then
        sed \
            -e "s|TUNNEL_ID|${TUNNEL_ID}|g" \
            -e "s|CREDENTIALS_PATH|${creds_file}|g" \
            -e "s|YOUR_HOSTNAME|${HOSTNAME}|g" \
            "$TEMPLATE_FILE" > "$CONFIG_FILE"
    else
        cat > "$CONFIG_FILE" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${creds_file}

ingress:
  - hostname: ${HOSTNAME}
    service: http://localhost:3000
  - service: http_status:404
EOF
    fi

    success "設定檔已寫入: $CONFIG_FILE"
    echo ""
    info "設定檔內容："
    echo "---"
    cat "$CONFIG_FILE"
    echo "---"
}

# ── Step 6: Print systemd service instructions ──────────────────────────────
print_service_instructions() {
    echo ""
    info "=========================================="
    info " systemd 服務設定"
    info "=========================================="
    echo ""
    info "Tunnel 設定檔已就緒。請使用 install-services.sh 統一管理 systemd 服務："
    echo ""
    echo "  sudo ./scripts/install-services.sh"
    echo ""
    info "此腳本會安裝 sparkle.service 和 sparkle-tunnel.service，"
    info "並統一管理 Node.js 和 cloudflared 的 systemd 服務。"
    echo ""
    warn "請勿使用 'cloudflared service install'，以免與 sparkle-tunnel.service 衝突。"
    echo ""
    info "手動測試 Tunnel（不透過 systemd）："
    info "  cloudflared tunnel --config $CONFIG_FILE run $TUNNEL_NAME"
}

# ── Step 7: Print summary ────────────────────────────────────────────────────
print_summary() {
    local webhook_url="https://${HOSTNAME}/api/webhook/line"

    echo ""
    echo "=========================================================="
    echo ""
    success "Cloudflare Tunnel 設定完成！"
    echo ""
    info "Tunnel 名稱:  $TUNNEL_NAME"
    info "Tunnel ID:    $TUNNEL_ID"
    info "設定檔:       $CONFIG_FILE"
    echo ""
    echo -e "${GREEN}=========================================================="
    echo -e " LINE Webhook URL (請貼到 LINE Developer Console):"
    echo -e ""
    echo -e "   $webhook_url"
    echo -e "==========================================================${NC}"
    echo ""
    info "設定步驟："
    info "  1. 設定 Cloudflare Access 保護應用程式（詳見 docs/cloudflare-access-setup.md）"
    info "  2. 前往 LINE Developer Console: https://developers.line.biz/"
    info "  3. 選擇你的 Messaging API Channel"
    info "  4. 在 Webhook settings 中填入上方 URL"
    info "  5. 點擊 Verify 確認連線正常"
    info "  6. 開啟 Use webhook"
    echo ""
    info "常用指令："
    info "  查看 Tunnel 狀態:   cloudflared tunnel info $TUNNEL_NAME"
    info "  查看服務日誌:       sudo journalctl -u sparkle-tunnel -f"
    info "  停止服務:           sudo systemctl stop sparkle-tunnel"
    info "  重啟服務:           sudo systemctl restart sparkle sparkle-tunnel"
    info "  手動執行:           cloudflared tunnel --config $CONFIG_FILE run $TUNNEL_NAME"
    echo ""

    # Security reminder
    echo -e "${YELLOW}=========================================================="
    echo -e " 安全提醒"
    echo -e "==========================================================${NC}"
    echo ""
    warn "此 Tunnel 會將完整 Sparkle 服務公開至網際網路。"
    warn "請務必設定 Cloudflare Access 保護應用程式："
    warn "  - /api/webhook/* 設為公開（Bypass）供 LINE Bot 使用"
    warn "  - 所有其他路徑需要透過 Cloudflare Access 驗證"
    warn ""
    warn "設定教學請參考: docs/cloudflare-access-setup.md"
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
    echo ""
    echo "=========================================================="
    echo "  Cloudflare Tunnel 設定工具"
    echo "  透過 Cloudflare Access 安全公開 Sparkle 服務"
    echo "=========================================================="
    echo ""

    check_cloudflared
    check_login
    get_or_create_tunnel
    configure_hostname
    generate_config
    print_service_instructions
    print_summary
}

main "$@"
