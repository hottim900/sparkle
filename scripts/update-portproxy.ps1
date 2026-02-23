# Sparkle — 更新 WSL Port Forwarding
# 右鍵 → 以系統管理員身分執行

$VpnIp = "YOUR_VPN_IP"
$Port = 3000

$WslIp = (wsl hostname -I).Trim().Split()[0]

netsh interface portproxy delete v4tov4 listenaddress=$VpnIp listenport=$Port 2>$null
netsh interface portproxy add v4tov4 listenaddress=$VpnIp listenport=$Port connectaddress=$WslIp connectport=$Port

Write-Host ""
Write-Host "Port forwarding updated: $VpnIp`:$Port -> $WslIp`:$Port" -ForegroundColor Green
Write-Host ""
netsh interface portproxy show all
Write-Host ""
Read-Host "Press Enter to close"
