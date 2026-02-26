#!/bin/bash
# 安裝 Sparkle systemd services
# 用法: sudo ./scripts/install-services.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="$SCRIPT_DIR/systemd"

echo "📦 安裝 Sparkle systemd services..."

# Determine the Linux username for the service
SPARKLE_USER="${SUDO_USER:-$USER}"
read -p "Linux username for Sparkle [$SPARKLE_USER]: " input
SPARKLE_USER="${input:-$SPARKLE_USER}"

echo "ℹ️  使用者: $SPARKLE_USER"

# Substitute YOUR_USER and install sparkle.service
sed "s|YOUR_USER|$SPARKLE_USER|g" "$SERVICE_DIR/sparkle.service" > /etc/systemd/system/sparkle.service
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
