# Capture Hub — Project Guide

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
    line.ts             # LINE message parser (!todo, !high prefixes)
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
  setup-cloudflared.sh  # Cloudflare Tunnel setup (interactive)

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

Currently deployed on home PC (WSL2) with WireGuard VPN.

```bash
# Start production server
NODE_ENV=production node --env-file=.env --import tsx server/index.ts

# Start Cloudflare Tunnel (for LINE webhook)
cloudflared tunnel run capture-hub
```

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
- CA also served at: `https://localhost:3000/ca/rootCA.pem` (copy in dist/)

### WSL2 Port Forwarding

Windows PowerShell (admin):
```powershell
netsh interface portproxy add v4tov4 listenaddress=YOUR_VPN_IP listenport=3000 connectaddress=<WSL_IP> connectport=3000
```
WSL IP may change on restart — check with `hostname -I` in WSL.

### Cloudflare Tunnel

- Named tunnel: `capture-hub` (ID: YOUR_OLD_TUNNEL_ID)
- Domain: `YOUR_WEBHOOK_DOMAIN` → only `/api/webhook/*` is public
- Config: `~/.cloudflared/config.yml`
- Credentials: `~/.cloudflared/YOUR_OLD_TUNNEL_ID-*.json`

### LINE Bot

- LINE Official Account with Messaging API enabled
- Webhook: `https://YOUR_WEBHOOK_DOMAIN/api/webhook/line`
- Commands: `?`=help, `!todo`=todo, `!high`=high priority
- Quick reply buttons shown after each save
- Auto-reply must be OFF in LINE Official Account Manager

## Conventions

- UI language: 繁體中文
- API: REST, JSON, Bearer token auth on /api/* (except /api/webhook/)
- Tags stored as JSON array string in SQLite
- Timestamps: ISO 8601 strings
- Database: SQLite WAL mode, FTS5 for search
- Tests: Vitest, in-memory SQLite, mock db module with vi.mock
