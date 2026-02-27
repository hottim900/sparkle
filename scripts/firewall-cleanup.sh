#!/bin/bash
# Sparkle — iptables 防火牆清理
# 由 sparkle.service ExecStopPost 呼叫

PORT="${PORT:-3000}"
VPN_SUBNET="${VPN_SUBNET:-10.0.0.0/8}"

if ! command -v iptables &>/dev/null; then
    exit 0
fi

while iptables -D INPUT -s 127.0.0.1 -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; do :; done
while iptables -D INPUT -s "$VPN_SUBNET" -p tcp --dport "$PORT" -j ACCEPT 2>/dev/null; do :; done
while iptables -D INPUT -p tcp --dport "$PORT" -j DROP 2>/dev/null; do :; done

echo "[firewall] iptables 規則已清除"
