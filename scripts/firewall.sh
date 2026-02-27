#!/bin/bash
# Sparkle — iptables 防火牆設定（defense-in-depth）
# 由 sparkle.service ExecStartPre 呼叫
#
# 退出碼:
#   0 = 規則已套用，或 iptables 不可用（優雅跳過）
#   1 = iptables 可用但規則套用失敗（不安全，阻止服務啟動）

set -uo pipefail

PORT="${PORT:-3000}"
VPN_SUBNET="${VPN_SUBNET:-10.0.0.0/8}"

# 檢查 iptables 是否可用
if ! command -v iptables &>/dev/null; then
    echo "[firewall] iptables 未安裝，跳過防火牆設定（依賴 Hyper-V Firewall + localhost 綁定）"
    exit 0
fi

# 測試 iptables 是否能正常運作（WSL2 kernel 可能不支援某些功能）
if ! iptables -L INPUT -n &>/dev/null; then
    echo "[firewall] iptables 無法運作（kernel 模組可能不支援），跳過防火牆設定"
    exit 0
fi

echo "[firewall] 設定 iptables 規則 (port=$PORT, vpn=$VPN_SUBNET)..."

# 先清除舊的 Sparkle 規則（冪等性）
while iptables -D INPUT -s 127.0.0.1 -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; do :; done
while iptables -D INPUT -s "$VPN_SUBNET" -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; do :; done
while iptables -D INPUT -p tcp --dport "$PORT" -j DROP 2>/dev/null; do :; done

# 套用規則 — 順序重要：先 ACCEPT 再 DROP
FAILED=0

iptables -A INPUT -s 127.0.0.1 -p tcp --dport "$PORT" -j ACCEPT || FAILED=1
iptables -A INPUT -s "$VPN_SUBNET" -p tcp --dport "$PORT" -j ACCEPT || FAILED=1
iptables -A INPUT -p tcp --dport "$PORT" -j DROP || FAILED=1

if [ "$FAILED" -ne 0 ]; then
    echo "[firewall] 錯誤：iptables 規則套用部分失敗，回滾所有規則"
    iptables -D INPUT -s 127.0.0.1 -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null || true
    iptables -D INPUT -s "$VPN_SUBNET" -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null || true
    iptables -D INPUT -p tcp --dport "$PORT" -j DROP 2>/dev/null || true
    echo "[firewall] 規則已回滾，服務將不啟動"
    exit 1
fi

echo "[firewall] iptables 規則套用完成"
exit 0
