#!/bin/bash
# 安裝 Sparkle systemd services
# 用法: sudo ./scripts/install-services.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_DIR="$SCRIPT_DIR/systemd"

echo "📦 安裝 Sparkle systemd services..."

# Determine the Linux username for the service
SPARKLE_USER="${SUDO_USER:-$USER}"
read -p "Linux username for Sparkle [$SPARKLE_USER]: " input
SPARKLE_USER="${input:-$SPARKLE_USER}"

echo "ℹ️  使用者: $SPARKLE_USER"

# 偵測 Node.js 路徑
detect_node() {
  local node_path
  # nvm 在 .bashrc 中載入，但 su - 的 non-interactive shell 不會 source .bashrc
  # 先嘗試直接找，找不到再嘗試載入 nvm
  node_path="$(su - "$SPARKLE_USER" -c 'which node' 2>/dev/null)" || true

  if [[ -z "$node_path" ]]; then
    node_path="$(su - "$SPARKLE_USER" -c 'source "$HOME/.nvm/nvm.sh" 2>/dev/null && which node' 2>/dev/null)" || true
  fi

  if [[ -z "$node_path" ]]; then
    echo "❌ 找不到 Node.js，請先安裝 Node.js (建議 v22.x)"
    exit 1
  fi

  NODE_BIN_DIR="$(dirname "$node_path")"
  local node_version
  node_version="$("$node_path" --version)"

  # 驗證 v22.x
  if [[ ! "$node_version" =~ ^v22\. ]]; then
    echo "⚠️  警告: 偵測到 Node.js $node_version，Sparkle 建議使用 v22.x"
    read -p "繼續安裝？ [y/N] " confirm
    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
      exit 1
    fi
  fi

  echo "ℹ️  Node.js: $node_version ($node_path)"
}

detect_node

# 偵測 cloudflared 路徑
detect_cloudflared() {
  local cf_path
  cf_path="$(su - "$SPARKLE_USER" -c 'which cloudflared' 2>/dev/null)" || true

  if [[ -z "$cf_path" ]]; then
    echo "⏭️  cloudflared 未安裝，跳過 tunnel service"
    INSTALL_TUNNEL=false
    return
  fi

  CLOUDFLARED_BIN="$cf_path"
  INSTALL_TUNNEL=true
  echo "ℹ️  cloudflared: $cf_path"
}

detect_cloudflared

# iptables 檢查（非必要，服務會優雅跳過）
if ! command -v iptables &>/dev/null; then
  echo "⚠️  iptables 未安裝 — sparkle.service 的防火牆規則將被跳過"
  echo "   如需防火牆功能，請執行: sudo apt install -y iptables"
fi

# Substitute placeholders and install sparkle.service
sed -e "s|YOUR_USER|$SPARKLE_USER|g" \
    -e "s|NODE_BIN_DIR|$NODE_BIN_DIR|g" \
    -e "s|SPARKLE_DIR|$PROJECT_DIR|g" \
    "$SERVICE_DIR/sparkle.service" > /etc/systemd/system/sparkle.service
echo "✅ 已安裝 sparkle.service"

# Install MCP HTTP service (for Claude.ai connector)
sed -e "s|YOUR_USER|$SPARKLE_USER|g" \
    -e "s|NODE_BIN_DIR|$NODE_BIN_DIR|g" \
    -e "s|SPARKLE_DIR|$PROJECT_DIR|g" \
    "$SERVICE_DIR/sparkle-mcp-http.service" > /etc/systemd/system/sparkle-mcp-http.service
echo "✅ 已安裝 sparkle-mcp-http.service"

# 確保防火牆腳本可執行
chmod +x "$PROJECT_DIR/scripts/firewall.sh" "$PROJECT_DIR/scripts/firewall-cleanup.sh"

# Install tunnel service if cloudflared is available
if [ "$INSTALL_TUNNEL" = true ]; then
  sed -e "s|YOUR_USER|$SPARKLE_USER|g" \
      -e "s|CLOUDFLARED_BIN|$CLOUDFLARED_BIN|g" \
      "$SERVICE_DIR/sparkle-tunnel.service" > /etc/systemd/system/sparkle-tunnel.service
  echo "✅ 已安裝 sparkle-tunnel.service"
fi

# 重新載入 systemd
systemctl daemon-reload

# 啟用開機自動啟動
systemctl enable sparkle.service
systemctl enable sparkle-mcp-http.service
if [ "$INSTALL_TUNNEL" = true ]; then
  systemctl enable sparkle-tunnel.service
fi

# 設定 .env 檔案權限
if [[ -f "$PROJECT_DIR/.env" ]]; then
  chmod 600 "$PROJECT_DIR/.env"
  chown "$SPARKLE_USER:$SPARKLE_USER" "$PROJECT_DIR/.env"
  echo "🔒 已設定 .env 權限為 600"
fi

# ── 啟動前檢查 ──────────────────────────────────────────────────────────────
START_SERVICES=true

if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  echo ""
  echo "⚠️  找不到 .env 檔案: $PROJECT_DIR/.env"
  echo "   服務需要 .env 才能正常啟動（AUTH_TOKEN 等設定）。"
  echo "   請先建立 .env 檔案："
  echo "     cp $PROJECT_DIR/.env.example $PROJECT_DIR/.env"
  echo "     vim $PROJECT_DIR/.env"
  echo "   然後執行："
  echo "     sudo systemctl restart sparkle"
  START_SERVICES=false
fi

if [[ ! -d "$PROJECT_DIR/dist" ]]; then
  echo ""
  echo "⚠️  找不到 dist/ 目錄: $PROJECT_DIR/dist"
  echo "   前端尚未建置，請執行："
  echo "     cd $PROJECT_DIR && npm run build"
fi

# 啟動服務（使用 restart 確保冪等）
if [ "$START_SERVICES" = true ]; then
  systemctl restart sparkle.service
  systemctl restart sparkle-mcp-http.service
  if [ "$INSTALL_TUNNEL" = true ]; then
    systemctl restart sparkle-tunnel.service
  fi

  echo ""
  echo "✅ 安裝完成！服務狀態："
  echo ""
  systemctl status sparkle.service --no-pager -l | head -5
  echo ""
  systemctl status sparkle-mcp-http.service --no-pager -l | head -5

  if [ "$INSTALL_TUNNEL" = true ]; then
    echo ""
    systemctl status sparkle-tunnel.service --no-pager -l | head -5
  fi
else
  echo ""
  echo "✅ 服務已安裝但尚未啟動（缺少必要設定檔）。"
  echo "   完成設定後請執行: sudo systemctl restart sparkle"
fi

echo ""
echo "常用指令："
echo "  查看狀態:  sudo systemctl status sparkle"
echo "  查看 log:  journalctl -u sparkle -f"
echo "  MCP log:   journalctl -u sparkle-mcp-http -f"
echo "  重啟:      sudo systemctl restart sparkle"
if [ "$INSTALL_TUNNEL" = true ]; then
  echo "  重啟全部:  sudo systemctl restart sparkle sparkle-mcp-http sparkle-tunnel"
fi
echo ""
echo "💡 WSL2 mirrored 模式下不需要 port forwarding"
echo "   如需外部裝置存取，請確認 Hyper-V Firewall 已開放 port 3000"
echo "   詳見 docs/self-hosting.md 的 WSL2 章節"
