[English](self-hosting.md)

# 自架指南

本指南說明如何將 Sparkle 部署為正式環境伺服器，包含 HTTPS、選用的 LINE Bot 整合、Obsidian 匯出等功能。

## 系統需求

- **Node.js 22+**（better-sqlite3 與 Node 24 不相容）
- **npm**
- 建議使用 **Linux**（macOS 及 WSL2 亦可運作）

## 安裝

```bash
git clone https://github.com/hottim900/sparkle.git
cd sparkle

# 安裝依賴套件並建置
npm install
npm run build
```

`npm run build` 會將前端編譯至 `dist/` 目錄，正式環境伺服器會以靜態檔案的方式提供這些內容。

## 設定

複製範例環境檔並進行編輯：

```bash
cp .env.example .env
```

### 環境變數

| 變數 | 必要 | 說明 |
|------|------|------|
| `NODE_ENV` | 是 | 設為 `production` |
| `PORT` | 是 | 伺服器連接埠（預設：`3000`） |
| `DATABASE_URL` | 是 | SQLite 資料庫檔案路徑（例如 `./data/todo.db`） |
| `AUTH_TOKEN` | 是 | 網頁 UI 認證用的 Bearer token。請選用一組高強度的隨機字串。 |
| `TLS_CERT` | 否 | TLS 憑證檔案路徑。省略則以純 HTTP 執行。 |
| `TLS_KEY` | 否 | TLS 私鑰檔案路徑。省略則以純 HTTP 執行。 |
| `LINE_CHANNEL_SECRET` | 否 | LINE Messaging API channel secret。啟用 LINE Bot 時必填。 |
| `LINE_CHANNEL_ACCESS_TOKEN` | 否 | LINE Messaging API access token。啟用 LINE Bot 時必填。 |

資料庫檔案及其父目錄會在首次執行時自動建立。

## HTTPS 設定（mkcert）

HTTPS 為選用，但建議啟用，特別是要在行動裝置上安裝 PWA 時。

1. 安裝 [mkcert](https://github.com/FiloSottile/mkcert)：

   ```bash
   # macOS
   brew install mkcert

   # Linux (Debian/Ubuntu)
   sudo apt install libnss3-tools
   curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
   chmod +x mkcert-v*-linux-amd64
   sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert
   ```

2. 安裝本機 CA 並產生憑證：

   ```bash
   mkcert -install
   mkdir -p certs
   mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost 127.0.0.1
   ```

   若需從區域網路中的其他裝置存取，請加入區域網路 IP：

   ```bash
   mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost 127.0.0.1 YOUR_LAN_IP
   ```

3. 更新 `.env`：

   ```
   TLS_CERT=./certs/cert.pem
   TLS_KEY=./certs/key.pem
   ```

4. 在行動裝置上安裝 CA 憑證：
   - CA 根憑證位於 `~/.local/share/mkcert/rootCA.pem`
   - **iOS**：透過 AirDrop 或 email 傳送檔案，至「設定 > 一般 > VPN 與裝置管理」安裝，再至「設定 > 一般 > 關於本機 > 憑證信任設定」啟用
   - **Android**：將檔案複製到裝置，至「設定 > 安全性 > 從儲存空間安裝」

## 執行

```bash
npm start
```

伺服器會在設定的連接埠啟動。若已設定 TLS，則以 HTTPS 執行；否則以純 HTTP 執行。

- HTTPS：`https://localhost:3000`
- HTTP：`http://localhost:3000`

## Systemd 服務（選用）

如需在 Linux 上自動啟動，可使用內建的 systemd 服務範本。

1. 編輯服務檔案以符合您的系統：

   ```bash
   # 複製範本
   sudo cp scripts/systemd/sparkle.service /etc/systemd/system/

   # 編輯 — 將 YOUR_USER 替換為您的 Linux 使用者名稱
   # 並確認 Node.js 路徑（執行 `which node` 查看）
   sudo nano /etc/systemd/system/sparkle.service
   ```

2. 啟用並啟動：

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable sparkle
   sudo systemctl start sparkle
   ```

3. 驗證：

   ```bash
   sudo systemctl status sparkle
   journalctl -u sparkle -f    # 追蹤日誌
   ```

## LINE Bot 設定（選用）

LINE Bot 讓您可以直接在 LINE 聊天中捕捉靈感、管理任務。

### 1. 建立 LINE Channel

1. 前往 [LINE Developers Console](https://developers.line.biz/)
2. 建立新的 Provider（或使用現有的）
3. 建立新的 **Messaging API** channel
4. 在 channel 設定中，記下 **Channel secret** 並簽發一組 **Channel access token（long-lived）**

### 2. 設定環境變數

在 `.env` 中加入：

```
LINE_CHANNEL_SECRET=your-channel-secret
LINE_CHANNEL_ACCESS_TOKEN=your-channel-access-token
```

### 3. 設定 Webhook URL

LINE webhook 端點為 `https://YOUR_DOMAIN/api/webhook/line`。

由於 webhook 必須可從公開網路存取，您需要以下其中一種方式：
- 指向您伺服器的公開網域
- Cloudflare Tunnel（參見下一節）
- 反向代理（nginx、Caddy 等）

在 LINE Developers Console 中：
1. 前往您 channel 的 **Messaging API** 頁籤
2. 將 **Webhook URL** 設為您的公開端點
3. 點擊 **Verify** 測試連線
4. 啟用 **Use webhook**
5. 停用 **Auto-reply messages**（在 LINE Official Account Manager > Response settings 中）

### 4. 可用指令

| 指令 | 說明 |
|------|------|
| `!todo <文字>` | 建立待辦事項 |
| `!high <文字>` | 建立高優先度待辦事項 |
| （直接輸入文字） | 建立閃念筆記 |
| `!fleeting` | 列出閃念筆記 |
| `!developing` | 列出發展中筆記 |
| `!permanent` | 列出永久筆記 |
| `!active` | 列出進行中的待辦事項 |
| `!today` | 今日焦點 |
| `!find <關鍵字>` | 搜尋 |
| `!stats` | 統計資料 |
| `?` / `help` | 顯示說明 |

查詢後，結果會以編號顯示。使用編號即可對項目進行操作（例如 `!detail 1`、`!done 2`、`!develop 3`）。

## Cloudflare Tunnel（選用）

Cloudflare Tunnel 透過 Cloudflare 的網路將你的 Sparkle 實例對外公開。存取控制由 **Cloudflare Access** 處理（請參閱下一節），而 `/api/webhook/*` 路徑保持開放供 LINE Bot 使用。

內建互動式設定腳本：

```bash
./scripts/setup-cloudflared.sh
```

此腳本會：
1. 如有需要，安裝 `cloudflared`
2. 向 Cloudflare 進行身分驗證
3. 建立命名 tunnel
4. 詢問要使用自有網域還是 `cfargotunnel.com` 位址
5. 產生透過純 HTTP 將所有流量導向本機 Sparkle 伺服器的設定檔
6. 可選擇安裝為 systemd 服務

產生的設定檔透過純 HTTP 連接 cloudflared 與本機 Sparkle server。由於兩個程序共用 localhost，中間的 TLS 並無必要且會增加額外開銷。若需要透過 HTTPS 直接從區域網路存取，請參閱 `scripts/cloudflared-config.yml.template` 中的註解說明如何搭配 mkcert 啟用。

也可以手動設定：

1. 安裝 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
2. 身分驗證：`cloudflared tunnel login`
3. 建立 tunnel：`cloudflared tunnel create sparkle`
4. 參考 `scripts/cloudflared-config.yml.template` 建立 `~/.cloudflared/config.yml`
5. 設定 DNS 路由：`cloudflared tunnel route dns sparkle sparkle.example.com`
6. 執行：`cloudflared tunnel run sparkle`

> **重要**：設定好 Tunnel 後，建議設定 Cloudflare Access 來保護你的 Sparkle 實例。請參閱下一節。

## Cloudflare Access（搭配 Tunnel 時建議啟用）

如果你透過 Cloudflare Tunnel 對外公開 Sparkle，建議設定 **Cloudflare Access** 來要求身份驗證後才能存取應用程式。這可以取代 VPN 的需求，同時確保你的資料安全。

重點：
- 免費方案最多支援 50 位使用者（不需信用卡）
- 支援 Email OTP、Google、GitHub 等身份驗證方式
- LINE Bot webhook 設定為繞過身份驗證
- MCP Server 和 localhost 存取不受影響

詳細的逐步設定指南，請參閱 **[docs/cloudflare-access-setup.md](cloudflare-access-setup.md)**。

## Obsidian 整合（選用）

Sparkle 可將永久筆記匯出為帶有 YAML frontmatter 的 Markdown 檔案，直接寫入您的 Obsidian vault。

1. 在瀏覽器中開啟 Sparkle
2. 前往**設定**
3. 啟用 **Obsidian 匯出**
4. 將 **Vault 路徑** 設為伺服器上 Obsidian vault 的目錄（例如 `/home/user/obsidian-vault/sparkle`）
5. 儲存

設定完成後，永久筆記上會出現匯出按鈕。匯出的檔案包含帶有標籤、別名及時間戳記的 YAML frontmatter。

## WSL2 注意事項（選用）

若在 WSL2 中執行 Sparkle，建議使用 **mirrored 網路模式** 以簡化設定。

### Mirrored 網路模式

Mirrored 模式下，WSL2 與 Windows 主機共用網路介面。這代表：
- 不需要連接埠轉發（`netsh portproxy`）
- 重開機後不會 IP 變動
- 服務直接綁定在主機網路上

在 `%USERPROFILE%\.wslconfig` 中加入：

```ini
[wsl2]
networkingMode=mirrored
```

然後重啟 WSL：`wsl --shutdown`

### Hyper-V 防火牆

Mirrored 模式下，WSL2 流量由 **Hyper-V 防火牆**（非一般 Windows 防火牆）控制。預設 inbound 為 Block。若需要外部裝置連入，以系統管理員身分在 PowerShell 中執行：

```powershell
# 方式一：允許所有 WSL2 外部連入
Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow

# 方式二：僅允許 port 3000
New-NetFirewallHyperVRule -Name "Sparkle" -DisplayName "Sparkle" -Direction Inbound -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol TCP -LocalPorts 3000
```

確認目前設定：

```powershell
Get-NetFirewallHyperVVMSetting -PolicyStore ActiveStore -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'
```

### iptables（縱深防禦）

內建的 `sparkle.service` 範本會在 WSL2 內設定 iptables 規則作為額外防護層。請在服務檔案中調整允許的子網路以符合您的網路設定。

## Claude Code MCP 伺服器（選用）

Sparkle 內建 MCP（Model Context Protocol）伺服器，讓 Claude Code 可以讀取、寫入及管理筆記。

### 建置

```bash
cd mcp-server
npm install
npm run build
```

### 向 Claude Code 註冊

```bash
claude mcp add sparkle --transport stdio --scope user \
  --env SPARKLE_AUTH_TOKEN=your-auth-token \
  --env SPARKLE_API_URL=https://localhost:3000 \
  --env NODE_TLS_REJECT_UNAUTHORIZED=0 \
  -- /path/to/node /path/to/sparkle/mcp-server/dist/index.js
```

將 `/path/to/node` 替換為 Node.js 執行檔的絕對路徑（`which node`），並根據實際情況調整其他路徑。若使用自簽憑證（mkcert），需要 `NODE_TLS_REJECT_UNAUTHORIZED=0`。

### 可用工具

| 工具 | 說明 |
|------|------|
| `sparkle_search` | 全文搜尋 |
| `sparkle_get_note` | 讀取單一筆記 |
| `sparkle_list_notes` | 列出筆記（含篩選條件） |
| `sparkle_create_note` | 建立新筆記或待辦事項 |
| `sparkle_update_note` | 更新現有項目 |
| `sparkle_advance_note` | 推進筆記成熟度階段 |
| `sparkle_export_to_obsidian` | 將筆記匯出至 Obsidian |
| `sparkle_get_stats` | 取得統計資料 |
| `sparkle_list_tags` | 列出所有標籤 |

### 測試

```bash
cd mcp-server
npx @modelcontextprotocol/inspector node dist/index.js
```

## 更新

```bash
git pull
npm install
npm run build

# 若使用 systemd：
sudo systemctl restart sparkle
```

若包含新的資料庫遷移，伺服器啟動時會自動執行。
