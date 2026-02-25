# Sparkle — Project Guide

## What is this

Self-hosted PWA for personal idea capture + task management with Zettelkasten note maturity flow. Quick capture on mobile, rich editing on desktop. LINE Bot integration for capturing ideas from chat. Obsidian export for permanent notes.

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
    items.ts            # CRUD + batch operations + POST /:id/export
    search.ts           # FTS5 full-text search
    stats.ts            # GET /api/stats, GET /api/stats/focus
    settings.ts         # GET/PUT /api/settings (Obsidian config)
    webhook.ts          # LINE Bot webhook (POST /api/webhook/line)
  lib/
    items.ts            # DB query functions (Drizzle + raw SQLite), type-status validation, auto-mapping
    stats.ts            # Stats (Zettelkasten + GTD) + focus query functions
    export.ts           # Obsidian .md export (frontmatter, sanitize filename, write to vault)
    settings.ts         # Settings CRUD (getSetting, getSettings, getObsidianSettings, updateSettings)
    line.ts             # LINE message/command parser
    line-format.ts      # LINE reply formatting (numbered list, detail, stats)
    line-session.ts     # LINE Bot session (numbered item mapping, in-memory)
    line-date.ts        # Natural language date parser (chrono-node zh.hant)
  schemas/items.ts      # Zod validation schemas (statusEnum, excludeStatus, batch actions)
  db/
    index.ts            # DB connection + schema migration (version 0→9)
    schema.ts           # Drizzle table schema (items + settings)
    fts.ts              # FTS5 virtual table + sync triggers

src/
  App.tsx               # Main layout, view routing, keyboard shortcuts
  components/
    auth-gate.tsx        # Login screen
    dashboard.tsx        # Review dashboard (Zettelkasten progress, focus, fleeting health)
    quick-capture.tsx    # New item form (GTD quick-select tags for todos)
    item-list.tsx        # Item list + filter chips + contextual batch actions + type grouping
    item-detail.tsx      # Editor + markdown preview + export button + aliases + linked items
    item-card.tsx        # List item display with tags, linked indicators, due date
    search-bar.tsx       # FTS search with keyword highlighting
    settings.tsx         # Settings page (Obsidian config + general tools)
    sidebar.tsx          # Desktop nav (筆記/待辦/共用 sections + settings)
    bottom-nav.tsx       # Mobile nav (Notes, Todos, Dashboard, Search, More + settings)
    fleeting-triage.tsx  # Fleeting note triage mode (發展/進行/封存/保留)
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

mcp-server/
  package.json            # MCP server dependencies
  tsconfig.json           # TypeScript config
  src/
    index.ts              # Entry point, McpServer + stdio transport
    types.ts              # Sparkle API response types
    client.ts             # Sparkle REST API client (fetch-based)
    format.ts             # Markdown formatting helpers
    tools/
      search.ts           # sparkle_search
      read.ts             # sparkle_get_note, sparkle_list_notes
      write.ts            # sparkle_create_note, sparkle_update_note
      workflow.ts         # sparkle_advance_note, sparkle_export_to_obsidian
      meta.ts             # sparkle_get_stats, sparkle_list_tags

certs/                  # mkcert TLS certificates (gitignored)
data/                   # SQLite database (gitignored)
```

## Development

```bash
# Start dev servers (two terminals)
npm run dev          # Vite on :5173, proxies /api to :3000
npm run dev:server   # Hono on :3000 with tsx watch

# IMPORTANT: Tests require node v22 (better-sqlite3 native module is incompatible with v24)
# If using nvm:
nvm use 22
# Or set PATH directly:
export PATH="/home/YOUR_USER/.nvm/versions/node/v22.22.0/bin:/usr/bin:/bin:$PATH"

# Tests (345 tests, 10 files — server only, no frontend tests)
npx vitest run                # Run all tests
npx vitest run --coverage     # With coverage (needs @vitest/coverage-v8)
npx vitest                    # Watch mode
# Coverage: server/lib ~97%, server/routes ~94%, frontend 0%

# Build — ALWAYS build after frontend changes before committing
npm run build        # Production frontend → dist/
```

**Important:** After any frontend code change, run `npm run build` before committing. The production deployment serves from `dist/`, so forgetting to build means changes won't be visible in production.

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

Obsidian export settings are stored in the `settings` table in SQLite (configured via Settings page or `PUT /api/settings`).

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
  - 新增：`!todo`=待辦, `!high`=高優先, 直接輸入=閃念筆記
  - 查詢：`!fleeting`=閃念筆記, `!developing`=發展中, `!permanent`=永久筆記, `!active`=進行中待辦, `!notes`=所有筆記, `!todos`=所有待辦, `!today`=今日焦點, `!find <keyword>`=搜尋, `!list <tag>`=標籤篩選, `!stats`=統計
  - 筆記推進（需先查詢建立 session）：`!develop N`=閃念→發展中, `!mature N`=發展中→永久, `!export N`=匯出到 Obsidian
  - 操作（需先查詢建立 session）：`!detail N`=詳情, `!due N <日期>`=設到期日(待辦only), `!track N [日期]`=從筆記建立追蹤待辦, `!tag N <標籤...>`=加標籤, `!untag N <標籤...>`=移除標籤, `!done N`=待辦完成, `!archive N`=封存, `!priority N <high|medium|low|none>`=優先度
  - `?`/`help`/`說明`=說明
  - `!inbox` 為 `!fleeting` 的向後相容別名
- Session: 查詢結果以 [N] 編號，後續用編號操作，10 分鐘 TTL，純記憶體
- Date parsing: chrono-node zh.hant，支援「明天」「3天後」「下週一」「3/15」「清除」
- Quick reply buttons shown after each response
- Chat mode must be OFF, Webhook must be ON in LINE Official Account Manager

### MCP Server (Claude Code Integration)

- MCP server in `mcp-server/` enables Claude Code to read/write Sparkle notes
- Config: `.mcp.json` at project root (Claude Code auto-discovers)
- Transport: stdio (subprocess of Claude Code)
- 9 tools: sparkle_search, sparkle_get_note, sparkle_list_notes, sparkle_create_note, sparkle_update_note, sparkle_advance_note, sparkle_export_to_obsidian, sparkle_get_stats, sparkle_list_tags
- Build: `cd mcp-server && npm install && npm run build`
- Dev: `cd mcp-server && npm run dev`
- Test: `cd mcp-server && npx @modelcontextprotocol/inspector node dist/index.js`

## Data Model

### Status System

Notes follow Zettelkasten maturity: `fleeting` → `developing` → `permanent` → `exported`
Todos use simplified lifecycle: `active` → `done`
Shared: `archived` (any type)

| Type | Valid Statuses | Default |
|------|---------------|---------|
| `note` | fleeting, developing, permanent, exported, archived | fleeting |
| `todo` | active, done, archived | active |

### Field Names (Obsidian-aligned)

```
id, type, title, content, status, priority, due, tags, origin, source, aliases, linked_note_id, created, modified
```

- `origin`: capture channel (LINE, web, import)
- `source`: reference URL (nullable)
- `aliases`: alternative names for Obsidian linking (JSON array)
- `due`: YYYY-MM-DD format, **todo-only** (notes ignore due; todo→note conversion clears due)
- `linked_note_id`: todo→note reference (nullable, todo-only; cleared on todo→note conversion)
- `linked_todo_count`: computed field in API responses — number of non-archived todos linked to a note (0 for todos)
- `linked_note_title`: computed field in API responses — title of linked note for todos (null if none)
- `created`/`modified`: ISO 8601 timestamps

### Type Conversion Auto-Mapping

When type changes (note ↔ todo), status auto-maps server-side. Auto-mapping overrides explicit status. Due date and linked_note_id are cleared on todo→note conversion.

### DB Migration

Schema version tracked in `schema_version` table (version 0→9). Each step is idempotent. Fresh install creates new schema directly at version 9. Migration 8→9 creates the `settings` table with Obsidian export defaults.

## Conventions

- UI language: 繁體中文
- API: REST, JSON, Bearer token auth on /api/* (except /api/webhook/)
- Tags stored as JSON array string in SQLite
- Aliases stored as JSON array string in SQLite
- Timestamps: ISO 8601 strings
- Database: SQLite WAL mode, FTS5 trigram tokenizer for search (supports Chinese)
- Tests: Vitest, in-memory SQLite, mock db module with vi.mock
- Obsidian export: .md with YAML frontmatter, local time (no TZ suffix), written to vault path. Config stored in `settings` table, read via `getObsidianSettings()`. `exportToObsidian(item, config)` is a pure function (no env dependency).
- Settings API: `GET /api/settings` returns all settings; `PUT /api/settings` accepts partial updates with Zod validation (key whitelist, vault path writability check when enabling)

## CLAUDE.md Maintenance

When making changes that affect this file's content (new features, field changes, status changes, new commands, test count changes, structural changes), **update CLAUDE.md in the same commit or a follow-up commit**. Do not wait for user to ask. Specifically update:
- Test count in Development section when tests are added/removed
- Project Structure when files are added/removed/renamed
- Data Model when schema, fields, or status system changes
- LINE Bot commands when commands are added/changed
- Environment Variables when new env vars are introduced
- Conventions when new patterns are established
