#!/bin/bash
# Capture Hub — 一鍵啟動/重啟
# 用法: sudo ./scripts/start.sh

set -euo pipefail

echo "🚀 Capture Hub 啟動中..."

# 1. 重啟 systemd services
echo "[1/2] 重啟 services..."
systemctl restart capture-hub.service
systemctl restart capture-hub-tunnel.service
sleep 3

# 檢查狀態
if systemctl is-active --quiet capture-hub.service; then
  echo "  ✅ Server 運行中"
else
  echo "  ❌ Server 啟動失敗"
  journalctl -u capture-hub.service --no-pager -n 5
  exit 1
fi

if systemctl is-active --quiet capture-hub-tunnel.service; then
  echo "  ✅ Tunnel 運行中"
else
  echo "  ❌ Tunnel 啟動失敗"
  journalctl -u capture-hub-tunnel.service --no-pager -n 5
fi

# 2. 提示 port forwarding
WSL_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "[2/2] Port forwarding"
echo "  如果手機連不上，在 Windows PowerShell (管理員) 執行："
echo "  右鍵執行 scripts/update-portproxy.ps1"
echo "  或手動: netsh interface portproxy add v4tov4 listenaddress=YOUR_VPN_IP listenport=3000 connectaddress=$WSL_IP connectport=3000"

echo ""
echo "========================================="
echo "  Capture Hub 已啟動"
echo "  PC:     https://localhost:3000"
echo "  手機:   https://YOUR_VPN_IP:3000"
echo "  LINE:   https://YOUR_WEBHOOK_DOMAIN/api/webhook/line"
echo "========================================="
echo ""
echo "常用指令："
echo "  狀態:  systemctl status capture-hub"
echo "  Log:   journalctl -u capture-hub -f"
echo "  重啟:  sudo systemctl restart capture-hub capture-hub-tunnel"
