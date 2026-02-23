#!/bin/bash
# Capture Hub — 一鍵啟動腳本
# 用法: ./scripts/start.sh

set -euo pipefail

PROJECT_DIR="/home/YOUR_USER/sparkle"
NODE_BIN="/home/YOUR_USER/.nvm/versions/node/v22.22.0/bin"
CLOUDFLARED="$HOME/.local/bin/cloudflared"
VPN_IP="YOUR_VPN_IP"
PORT=3000

export PATH="$NODE_BIN:$PATH"

echo "🚀 Capture Hub 啟動中..."

# 1. 殺掉舊 process
echo "[1/4] 清理舊 process..."
fuser $PORT/tcp 2>/dev/null | xargs kill 2>/dev/null || true
pkill -f "cloudflared tunnel run" 2>/dev/null || true
sleep 1

# 2. 啟動 server
echo "[2/4] 啟動 HTTPS server..."
cd "$PROJECT_DIR"
NODE_ENV=production node --env-file=.env --import tsx server/index.ts &
SERVER_PID=$!
sleep 3

if kill -0 $SERVER_PID 2>/dev/null; then
  echo "  ✅ Server 啟動 (PID: $SERVER_PID)"
else
  echo "  ❌ Server 啟動失敗"
  exit 1
fi

# 3. 啟動 Cloudflare Tunnel
echo "[3/4] 啟動 Cloudflare Tunnel..."
$CLOUDFLARED tunnel run capture-hub &>/dev/null &
TUNNEL_PID=$!
sleep 3

if kill -0 $TUNNEL_PID 2>/dev/null; then
  echo "  ✅ Tunnel 啟動 (PID: $TUNNEL_PID)"
else
  echo "  ❌ Tunnel 啟動失敗"
fi

# 4. 更新 Windows port forwarding
echo "[4/4] 更新 Windows port forwarding..."
WSL_IP=$(hostname -I | awk '{print $1}')
# 透過 PowerShell 更新 portproxy
powershell.exe -Command "
  netsh interface portproxy delete v4tov4 listenaddress=$VPN_IP listenport=$PORT 2>\$null;
  netsh interface portproxy add v4tov4 listenaddress=$VPN_IP listenport=$PORT connectaddress=$WSL_IP connectport=$PORT
" 2>/dev/null && echo "  ✅ Port forwarding: $VPN_IP:$PORT → $WSL_IP:$PORT" \
             || echo "  ⚠️  Port forwarding 需要管理員權限，請手動執行：
  netsh interface portproxy add v4tov4 listenaddress=$VPN_IP listenport=$PORT connectaddress=$WSL_IP connectport=$PORT"

echo ""
echo "========================================="
echo "  Capture Hub 已啟動"
echo "  PC:     https://localhost:$PORT"
echo "  手機:   https://$VPN_IP:$PORT"
echo "  LINE:   https://YOUR_WEBHOOK_DOMAIN/api/webhook/line"
echo "========================================="
echo ""
echo "停止: kill $SERVER_PID $TUNNEL_PID"
echo "或按 Ctrl+C"

# 等待，Ctrl+C 時清理
trap "echo '正在停止...'; kill $SERVER_PID $TUNNEL_PID 2>/dev/null; exit 0" INT TERM
wait
