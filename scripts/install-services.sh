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
  node_path="$(su - "$SPARKLE_USER" -c 'which node' 2>/dev/null)" || true

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

# Substitute YOUR_USER and NODE_BIN_DIR, then install sparkle.service
sed -e "s|YOUR_USER|$SPARKLE_USER|g" -e "s|NODE_BIN_DIR|$NODE_BIN_DIR|g" \
    "$SERVICE_DIR/sparkle.service" > /etc/systemd/system/sparkle.service
echo "✅ 已安裝 sparkle.service"

# Only install tunnel service if cloudflared is available
if command -v cloudflared &>/dev/null; then
  sed "s|YOUR_USER|$SPARKLE_USER|g" "$SERVICE_DIR/sparkle-tunnel.service" > /etc/systemd/system/sparkle-tunnel.service
  echo "✅ 已安裝 sparkle-tunnel.service"
  INSTALL_TUNNEL=true
else
  echo "⏭️  cloudflared not found — skipping tunnel service"
  INSTALL_TUNNEL=false
fi

# 重新載入 systemd
systemctl daemon-reload

# 啟用開機自動啟動
systemctl enable sparkle.service
if [ "$INSTALL_TUNNEL" = true ]; then
  systemctl enable sparkle-tunnel.service
fi

# 立即啟動
systemctl start sparkle.service
if [ "$INSTALL_TUNNEL" = true ]; then
  systemctl start sparkle-tunnel.service
fi

# 設定 .env 檔案權限
if [[ -f "$PROJECT_DIR/.env" ]]; then
  chmod 600 "$PROJECT_DIR/.env"
  chown "$SPARKLE_USER:$SPARKLE_USER" "$PROJECT_DIR/.env"
  echo "🔒 已設定 .env 權限為 600"
fi

echo ""
echo "✅ 安裝完成！服務狀態："
echo ""
systemctl status sparkle.service --no-pager -l | head -5

if [ "$INSTALL_TUNNEL" = true ]; then
  echo ""
  systemctl status sparkle-tunnel.service --no-pager -l | head -5
fi

echo ""
echo "常用指令："
echo "  查看狀態:  sudo systemctl status sparkle"
echo "  查看 log:  journalctl -u sparkle -f"
echo "  重啟:      sudo systemctl restart sparkle"
if [ "$INSTALL_TUNNEL" = true ]; then
  echo "  重啟全部:  sudo systemctl restart sparkle sparkle-tunnel"
fi
echo ""
echo "💡 WSL2 mirrored 模式下不需要 port forwarding"
echo "   如需外部裝置存取，請確認 Hyper-V Firewall 已開放 port 3000"
echo "   詳見 docs/self-hosting.md 的 WSL2 章節"
