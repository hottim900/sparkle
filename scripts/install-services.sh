#!/bin/bash
# 安裝 Sparkle systemd services
# 用法: sudo ./scripts/install-services.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="$SCRIPT_DIR/systemd"

echo "📦 安裝 Sparkle systemd services..."

# 複製 service 檔案
cp "$SERVICE_DIR/sparkle.service" /etc/systemd/system/
cp "$SERVICE_DIR/sparkle-tunnel.service" /etc/systemd/system/

# 重新載入 systemd
systemctl daemon-reload

# 啟用開機自動啟動
systemctl enable sparkle.service
systemctl enable sparkle-tunnel.service

# 立即啟動
systemctl start sparkle.service
systemctl start sparkle-tunnel.service

echo ""
echo "✅ 安裝完成！服務狀態："
echo ""
systemctl status sparkle.service --no-pager -l | head -5
echo ""
systemctl status sparkle-tunnel.service --no-pager -l | head -5
echo ""
echo "常用指令："
echo "  查看狀態:  sudo systemctl status sparkle"
echo "  查看 log:  journalctl -u sparkle -f"
echo "  重啟:      sudo systemctl restart sparkle sparkle-tunnel"
echo ""
echo "⚠️  Port forwarding 需要在 Windows 端手動執行："
echo "  右鍵以管理員身分執行 scripts/update-portproxy.ps1"
