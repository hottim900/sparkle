#!/bin/bash
# 安裝 Sparkle systemd services
# 用法: sudo ./scripts/install-services.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="$SCRIPT_DIR/systemd"

echo "📦 安裝 Sparkle systemd services..."

# 複製 service 檔案
cp "$SERVICE_DIR/capture-hub.service" /etc/systemd/system/
cp "$SERVICE_DIR/capture-hub-tunnel.service" /etc/systemd/system/

# 重新載入 systemd
systemctl daemon-reload

# 啟用開機自動啟動
systemctl enable capture-hub.service
systemctl enable capture-hub-tunnel.service

# 立即啟動
systemctl start capture-hub.service
systemctl start capture-hub-tunnel.service

echo ""
echo "✅ 安裝完成！服務狀態："
echo ""
systemctl status capture-hub.service --no-pager -l | head -5
echo ""
systemctl status capture-hub-tunnel.service --no-pager -l | head -5
echo ""
echo "常用指令："
echo "  查看狀態:  sudo systemctl status capture-hub"
echo "  查看 log:  journalctl -u capture-hub -f"
echo "  重啟:      sudo systemctl restart capture-hub capture-hub-tunnel"
echo ""
echo "⚠️  Port forwarding 需要在 Windows 端手動執行："
echo "  右鍵以管理員身分執行 scripts/update-portproxy.ps1"
