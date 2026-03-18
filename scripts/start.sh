#!/bin/bash
# Sparkle — 一鍵啟動/重啟
# 用法: sudo ./scripts/start.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# 檢查 .env 權限
if [[ -f "$PROJECT_DIR/.env" ]]; then
  PERMS=$(stat -c '%a' "$PROJECT_DIR/.env")
  if [[ "$PERMS" != "600" ]]; then
    echo "⚠️  警告: .env 檔案權限為 $PERMS，建議設定為 600"
    echo "   執行: chmod 600 $PROJECT_DIR/.env"
  fi
fi

echo "🚀 Sparkle 啟動中..."

# 1. 重啟 systemd services
echo "重啟 services..."
systemctl restart sparkle.service sparkle-mcp-http.service sparkle-tunnel.service
sleep 3

# 檢查狀態
if systemctl is-active --quiet sparkle.service; then
  echo "  ✅ Server 運行中"
else
  echo "  ❌ Server 啟動失敗"
  journalctl -u sparkle.service --no-pager -n 5
  exit 1
fi

if systemctl is-active --quiet sparkle-mcp-http.service; then
  echo "  ✅ MCP HTTP Server 運行中"
else
  echo "  ❌ MCP HTTP Server 啟動失敗"
  journalctl -u sparkle-mcp-http.service --no-pager -n 5
fi

if systemctl is-active --quiet sparkle-tunnel.service; then
  echo "  ✅ Tunnel 運行中"
else
  echo "  ❌ Tunnel 啟動失敗"
  journalctl -u sparkle-tunnel.service --no-pager -n 5
fi

echo ""
echo "========================================="
echo "  Sparkle 已啟動"
echo "  PC:     http://localhost:3000"
echo "  MCP:    https://sparkle-mcp.kalthor.cc/mcp"
echo "  手機:   https://YOUR_TUNNEL_HOSTNAME (Cloudflare Tunnel)"
echo "  LINE:   https://YOUR_WEBHOOK_DOMAIN/api/webhook/line"
echo "========================================="
echo ""
echo "常用指令："
echo "  狀態:  systemctl status sparkle sparkle-mcp-http"
echo "  Log:   journalctl -u sparkle -f"
echo "  MCP:   journalctl -u sparkle-mcp-http -f"
echo "  重啟:  sudo systemctl restart sparkle sparkle-mcp-http sparkle-tunnel"
