# Sparkle — Project Guide

## What is this

Self-hosted PWA for personal idea capture + task management. Quick capture on mobile, rich editing on desktop. LINE Bot integration for capturing ideas from chat.

## Tech Stack

- **Frontend**: Vite + React 19 + TypeScript + Tailwind CSS + shadcn/ui (Radix)
- **Backend**: Hono (Node.js) + Drizzle ORM + better-sqlite3 + FTS5
- **PWA**: vite-plugin-pwa + Workbox + IndexedDB offline queue
- **Validation**: Zod on all API endpoints
- **Themes**: next-themes (dark/light)
- **Toast**: sonner
- **Icons**: lucide-react

## Project Structure

```
server/
  index.ts              # Hono app, route registration, HTTPS/TLS support
  middleware/auth.ts     # Bearer token auth (skips /api/webhook/)
  routes/
    items.ts            # CRUD + batch operations
    search.ts           # FTS5 full-text search
    stats.ts            # GET /api/stats, GET /api/stats/focus
    webhook.ts          # LINE Bot webhook (POST /api/webhook/line)
  lib/
    items.ts            # DB query functions (Drizzle + raw SQLite)
    stats.ts            # Stats + focus query functions
    line.ts             # LINE message/command parser
    line-session.ts     # LINE Bot session (numbered item mapping, in-memory)
    line-date.ts        # Natural language date parser (chrono-node zh.hant)
  schemas/items.ts      # Zod validation schemas
  db/
    index.ts            # DB connection (better-sqlite3 + Drizzle)
    schema.ts           # Drizzle table schema
    fts.ts              # FTS5 virtual table + sync triggers

src/
  App.tsx               # Main layout, view routing, keyboard shortcuts
  components/
    auth-gate.tsx        # Login screen
    dashboard.tsx        # Review dashboard (stats, focus, inbox health)
    quick-capture.tsx    # New item form
    item-list.tsx        # Item list + batch operations + sort
    item-detail.tsx      # Editor + markdown preview (react-markdown)
    item-card.tsx        # List item display with due date indicators
    search-bar.tsx       # FTS search with keyword highlighting
    sidebar.tsx          # Desktop nav + tags + export/import
    bottom-nav.tsx       # Mobile nav (inbox, active, notes, search)
    inbox-triage.tsx     # GTD triage mode
    offline-indicator.tsx
    install-prompt.tsx   # PWA install banner
  lib/
    api.ts              # API client (auto-logout on 401)
    types.ts            # TypeScript interfaces + ViewType
  hooks/
    use-keyboard-shortcuts.ts  # N=new, /=search, Esc=close
  sw.ts                 # Service worker (offline capture queue)

scripts/
  start.sh              # One-command restart (uses systemctl)
  install-services.sh   # Install systemd services
  setup-cloudflared.sh  # Cloudflare Tunnel setup (interactive)
  update-portproxy.ps1  # Windows port forwarding (run as admin)
  systemd/
    sparkle.service         # Node.js HTTPS server
    sparkle-tunnel.service  # Cloudflare Tunnel

certs/                  # mkcert TLS certificates (gitignored)
data/                   # SQLite database (gitignored)
```

## Development

```bash
# Start dev servers (two terminals)
npm run dev          # Vite on :5173, proxies /api to :3000
npm run dev:server   # Hono on :3000 with tsx watch

# Tests
npx vitest run       # 79 tests across 4 files
npx vitest           # Watch mode

# Build
npm run build        # Production frontend → dist/
```

## Production Deployment

Deployed on home PC (WSL2) with WireGuard VPN. Managed by systemd.

### First-time setup

```bash
sudo ./scripts/install-services.sh   # Install and start systemd services
```

### Restart / manage

```bash
sudo ./scripts/start.sh                                    # Restart all
sudo systemctl restart sparkle sparkle-tunnel      # Restart manually
sudo systemctl status sparkle                          # Check status
journalctl -u sparkle -f                               # Tail logs
```

### After PC reboot

WSL services auto-start. Only manual step: run `scripts/update-portproxy.ps1` as admin in Windows (right-click → Run as Administrator) to update port forwarding.

### Environment Variables (.env)

```
NODE_ENV=production
PORT=3000
DATABASE_URL=/home/YOUR_USER/sparkle/data/todo.db
AUTH_TOKEN=<login-token>
TLS_CERT=/home/YOUR_USER/sparkle/certs/YOUR_VPN_IP+2.pem
TLS_KEY=/home/YOUR_USER/sparkle/certs/YOUR_VPN_IP+2-key.pem
LINE_CHANNEL_SECRET=<from-line-console>
LINE_CHANNEL_ACCESS_TOKEN=<from-line-console>
```

### Access Points

| What | URL |
|------|-----|
| PC browser | https://localhost:3000 |
| Mobile (VPN) | https://YOUR_VPN_IP:3000 |
| LINE webhook | https://YOUR_WEBHOOK_DOMAIN/api/webhook/line |

### HTTPS (mkcert)

- CA root: `~/.local/share/mkcert/rootCA.pem`
- Cert covers: `YOUR_VPN_IP`, `localhost`, `127.0.0.1`
- CA installed on: Windows (certutil), iOS/Android (profile)

### Firewall (iptables)

Port 3000 透過 iptables 限制只允許特定來源存取，規則在 `sparkle.service` 的 `ExecStartPre` 自動設定（WSL2 重開後 iptables 規則會消失，service 啟動時自動重建）：

- `127.0.0.1` → ACCEPT（localhost / Cloudflare Tunnel）
- `YOUR_VPN_SUBNET/24` → ACCEPT（WireGuard VPN 子網）
- `172.16.0.0/12` → ACCEPT（Windows host 經 port proxy 轉發進 WSL2 的流量）
- 其餘 → DROP

需要 `iptables` 套件：`sudo apt install -y iptables`

### WSL2 Port Forwarding

After PC reboot, right-click `scripts/update-portproxy.ps1` → Run as Administrator.

Or manually in PowerShell (admin):
```powershell
$wslIp = wsl hostname -I | ForEach-Object { $_.Trim().Split()[0] }
netsh interface portproxy add v4tov4 listenaddress=YOUR_VPN_IP listenport=3000 connectaddress=$wslIp connectport=3000
```

### Cloudflare Tunnel

- Named tunnel: `sparkle` (ID: YOUR_TUNNEL_ID)
- Domain: `YOUR_WEBHOOK_DOMAIN` → only `/api/webhook/*` is public
- Config: `~/.cloudflared/config.yml`
- Credentials: `~/.cloudflared/YOUR_TUNNEL_ID-*.json`

### LINE Bot

- LINE Official Account with Messaging API enabled
- Webhook: `https://YOUR_WEBHOOK_DOMAIN/api/webhook/line`
- Commands:
  - 新增：`!todo`=待辦, `!high`=高優先, 直接輸入=筆記
  - 查詢：`!inbox`=收件匣, `!active`=進行中, `!today`=今日焦點, `!find <keyword>`=搜尋, `!list <tag>`=標籤篩選, `!stats`=統計
  - 操作（需先查詢建立 session）：`!detail N`=詳情, `!due N <日期>`=設到期日, `!tag N <標籤...>`=加標籤
  - `?`/`help`/`說明`=說明
- Session: 查詢結果以 [N] 編號，後續用編號操作，10 分鐘 TTL，純記憶體
- Date parsing: chrono-node zh.hant，支援「明天」「3天後」「下週一」「3/15」「清除」
- Quick reply buttons shown after each response
- Chat mode must be OFF, Webhook must be ON in LINE Official Account Manager

## Conventions

- UI language: 繁體中文
- API: REST, JSON, Bearer token auth on /api/* (except /api/webhook/)
- Tags stored as JSON array string in SQLite
- Timestamps: ISO 8601 strings
- Database: SQLite WAL mode, FTS5 trigram tokenizer for search (supports Chinese)
- Tests: Vitest, in-memory SQLite, mock db module with vi.mock
