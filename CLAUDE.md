# Sparkle — Project Guide

## What is this

Self-hosted PWA for personal idea capture + task management with Zettelkasten note maturity flow. Quick capture on mobile, rich editing on desktop. LINE Bot integration for capturing ideas from chat. Obsidian export for permanent notes.

## Tech Stack

- **Frontend**: Vite + React 19 + TypeScript + Tailwind CSS + shadcn/ui (Radix)
- **Backend**: Hono (Node.js) + Drizzle ORM + better-sqlite3 + FTS5 + hono-rate-limiter + marked (SSR Markdown)
- **PWA**: vite-plugin-pwa + Workbox + IndexedDB offline queue
- **Validation**: Zod on all API endpoints
- **Themes**: next-themes (dark/light)
- **Toast**: sonner
- **Icons**: lucide-react

## Project Structure

```
server/
  index.ts              # Hono app, route registration, HTTPS/TLS support, startup validation, graceful shutdown
  middleware/
    auth.ts             # Bearer token auth (skips /api/webhook/ and /api/public/)
    rate-limit.ts       # Rate limiting (API general, auth failure, webhook)
  routes/
    items.ts            # CRUD + batch operations + GET /:id/linked-todos + POST /:id/export
    search.ts           # FTS5 full-text search
    stats.ts            # GET /api/stats, GET /api/stats/focus
    settings.ts         # GET/PUT /api/settings (Obsidian config)
    shares.ts           # Share management (create, list, revoke) — auth required
    public.ts           # Public routes (JSON API + SSR page at /s/:token) — no auth
    webhook.ts          # LINE Bot webhook (POST /api/webhook/line)
  lib/
    items.ts            # DB query functions (Drizzle), type-status validation, auto-mapping, linked_note_id filter
    stats.ts            # Stats (Zettelkasten + GTD) + focus query functions
    export.ts           # Obsidian .md export (frontmatter, sanitize filename, write to vault)
    shutdown.ts         # Graceful shutdown (SIGTERM/SIGINT, WAL checkpoint, DB close)
    safe-compare.ts     # Timing-safe string comparison (crypto.timingSafeEqual)
    settings.ts         # Settings CRUD (getSetting, getSettings, getObsidianSettings, updateSettings)
    line.ts             # LINE message/command parser
    line-format.ts      # LINE reply formatting (numbered list, detail, stats)
    line-session.ts     # LINE Bot session (numbered item mapping, in-memory)
    line-date.ts        # Natural language date parser (chrono-node zh.hant)
    shares.ts           # Share token CRUD (create, query by token/item, list, revoke)
    render-public-page.ts # SSR HTML rendering (marked, OpenGraph tags, dark mode CSS)
  schemas/
    items.ts            # Zod validation schemas (statusEnum, excludeStatus, batch actions)
    shares.ts           # Zod schema for share creation (visibility enum)
  db/
    index.ts            # DB connection + schema migration (version 0→11)
    schema.ts           # Drizzle table schema (items + settings + share_tokens)
    fts.ts              # FTS5 virtual table + sync triggers

src/
  App.tsx               # Main layout, view routing, keyboard shortcuts
  components/
    auth-gate.tsx        # Login screen
    dashboard.tsx        # Review dashboard (Zettelkasten progress, focus, fleeting health, scratch count)
    quick-capture.tsx    # New item form (GTD quick-select tags for todos)
    item-list.tsx        # Item list + filter chips + contextual batch actions + type grouping
    item-detail.tsx      # Editor + markdown preview + export button + aliases + linked items + share button
    item-card.tsx        # List item display with tags, linked indicators, due date, share indicators
    search-bar.tsx       # FTS search with keyword highlighting
    settings.tsx         # Settings page (Obsidian config + share management + general tools)
    share-dialog.tsx     # Share dialog (create share, copy link, revoke)
    sidebar.tsx          # Desktop nav (筆記/待辦/暫存/共用 sections + settings)
    bottom-nav.tsx       # Mobile nav (Notes, Todos, Scratch, Dashboard, Search + settings)
    fleeting-triage.tsx  # Fleeting note triage mode (發展/進行/封存/保留)
    offline-indicator.tsx
    install-prompt.tsx   # PWA install banner
  lib/
    api.ts              # API client (auto-logout on 401, shares API)
    types.ts            # TypeScript interfaces + ViewType + ShareToken types
  hooks/
    use-keyboard-shortcuts.ts  # N=new, /=search, Esc=close
  sw.ts                 # Service worker (offline capture queue)

scripts/
  start.sh              # One-command restart (uses systemctl)
  install-services.sh   # Install systemd services
  setup-cloudflared.sh  # Cloudflare Tunnel setup (interactive, auto-detects mkcert CA)
  setup-backup.sh       # Restic backup one-time setup (interactive)
  backup.sh             # Automated DB backup (cron-compatible)
  firewall.sh           # iptables setup (atomic all-or-nothing, graceful skip if unavailable)
  firewall-cleanup.sh   # iptables cleanup on service stop
  cloudflared-config.yml.template  # Tunnel config template (caPool for mkcert TLS)
  systemd/
    sparkle.service         # Node.js HTTPS server
    sparkle-tunnel.service  # Cloudflare Tunnel

docs/
  self-hosting.md              # Self-hosting guide (English)
  self-hosting.zh-TW.md        # Self-hosting guide (繁體中文)
  cloudflare-access-setup.md   # Cloudflare Access setup guide (繁體中文)

mcp-server/
  package.json            # MCP server dependencies
  tsconfig.json           # TypeScript config
  src/
    index.ts              # Entry point, McpServer + stdio transport + instructions
    types.ts              # Sparkle API response types
    client.ts             # Sparkle REST API client (fetch-based)
    format.ts             # Markdown formatting helpers
    docs/
      instructions.ts     # Server instructions (role definition, workflow, injected into system prompt)
      content.ts          # Documentation content map (7 topics, shared by resources + guide tool)
      resources.ts        # MCP Resource registration (sparkle://docs/*)
    tools/
      search.ts           # sparkle_search
      read.ts             # sparkle_get_note, sparkle_list_notes
      write.ts            # sparkle_create_note, sparkle_update_note (note/todo/scratch, full field support)
      workflow.ts         # sparkle_advance_note, sparkle_export_to_obsidian
      meta.ts             # sparkle_get_stats, sparkle_list_tags
      guide.ts            # sparkle_guide (documentation query by topic)

certs/                  # mkcert TLS certificates (gitignored)
data/                   # SQLite database (gitignored)
```

## Development

```bash
# Start dev servers (two terminals)
npm run dev          # Vite on :5173, proxies /api to :3000
npm run dev:server   # Hono on :3000 with tsx watch

# IMPORTANT: Tests require node v22 (better-sqlite3 native module is incompatible with v24)
nvm use 22

# Tests (462 tests, 14 files — server only, no frontend tests)
npx vitest run                # Run all tests
npx vitest run --coverage     # With coverage (needs @vitest/coverage-v8)
npx vitest                    # Watch mode
# Coverage: server/lib ~97%, server/routes ~94%, frontend 0%

# Build — ALWAYS build after frontend changes before committing
npm run build        # Production frontend → dist/
```

**Important:** After any frontend code change, run `npm run build` before committing. The production deployment serves from `dist/`, so forgetting to build means changes won't be visible in production.

## Production Deployment

Self-hosted on WSL2 (mirrored networking mode) with WireGuard VPN. Managed by systemd. See `docs/self-hosting.md` for full setup instructions.

### Quick Reference

```bash
# First-time setup
sudo ./scripts/install-services.sh

# Restart
sudo ./scripts/start.sh
sudo systemctl restart sparkle sparkle-tunnel

# Status & logs
sudo systemctl status sparkle
journalctl -u sparkle -f
```

### Environment Variables (.env)

Copy `.env.example` to `.env` and fill in your values. See `.env.example` for all available variables.

### HTTPS (mkcert)

- Generate certs with mkcert for your local IPs / localhost
- Install the CA root on all devices that need to access the app
- Configure cert paths in `.env` (TLS_CERT, TLS_KEY)

### Firewall

**Hyper-V Firewall**: In mirrored mode, WSL2 inbound traffic is controlled by Hyper-V firewall (default: Block). Configure via `Set-NetFirewallHyperVVMSetting` or `New-NetFirewallHyperVRule`.

**iptables** rules via `scripts/firewall.sh` provide defense-in-depth:
- `127.0.0.1` → ACCEPT (localhost / Cloudflare Tunnel)
- VPN subnet → ACCEPT (WireGuard)
- All others → DROP
- Atomic setup: all rules succeed or all rollback; gracefully skips if iptables unavailable
- Cleanup on stop via `scripts/firewall-cleanup.sh`

Requires `iptables` package: `sudo apt install -y iptables`

### Backup (restic + sqlite3)

- Run `scripts/setup-backup.sh` for interactive first-time setup (installs restic, inits repo, generates password)
- `scripts/backup.sh` runs unattended: `VACUUM INTO` snapshot → `gzip --rsyncable` → `restic backup` → retention prune
- `VACUUM INTO` creates compacted, consistent hot snapshot (safe with WAL mode)
- `gzip --rsyncable` produces dedup-friendly output for restic incremental backups
- Retention: 7 daily, 4 weekly, 3 monthly (`--group-by host,tags`)
- Tags: `--tag db,sqlite,sparkle`
- Env vars: `RESTIC_REPOSITORY` (default `~/sparkle-backups`), `RESTIC_PASSWORD_FILE` (required), `HEALTHCHECK_URL` (optional)
- Suggested cron: `0 3 * * *` (daily at 3 AM)
- Restore: `restic restore latest --tag sparkle --target /tmp/sparkle-restore` → `gunzip` → stop service → copy DB → remove stale WAL/SHM → `chown` → start service

### Cloudflare Tunnel + Access

- Run `scripts/setup-cloudflared.sh` for interactive setup (new tunnel only; existing tunnels already have separate configs)
- Full service exposed through Tunnel; access controlled by **Cloudflare Access** (Zero Trust)
- `/api/webhook/*` bypasses CF Access (LINE Bot needs direct access)
- Config stored in `~/.cloudflared/`, template at `scripts/cloudflared-config.yml.template`
- **Deployed configs are per-tunnel** (e.g., `sparkle-config.yml`, `lanshare-config.yml`), separate from the repo template
- `sparkle-tunnel.service` references `~/.cloudflared/sparkle-config.yml` directly
- Setup guide: `docs/cloudflare-access-setup.md`

### LINE Bot

- LINE Official Account with Messaging API enabled
- Webhook URL: `https://YOUR_DOMAIN/api/webhook/line`
- Commands:
  - 新增：`!todo`=待辦, `!high`=高優先, `!tmp <內容>`=暫存, 直接輸入=閃念筆記
  - 查詢：`!fleeting`=閃念筆記, `!developing`=發展中, `!permanent`=永久筆記, `!active`=進行中待辦, `!scratch`/`!s`=暫存項目, `!notes`=所有筆記, `!todos`=所有待辦, `!today`=今日焦點, `!find <keyword>`=搜尋, `!list <tag>`=標籤篩選, `!stats`=統計
  - 筆記推進（需先查詢建立 session）：`!develop N`=閃念→發展中, `!mature N`=發展中→永久, `!export N`=匯出到 Obsidian
  - 暫存操作（需先查詢建立 session）：`!delete N`=刪除項目, `!upgrade N`=暫存升級為閃念筆記
  - 操作（需先查詢建立 session）：`!detail N`=詳情, `!due N <日期>`=設到期日(待辦only), `!track N [日期]`=從筆記建立追蹤待辦, `!tag N <標籤...>`=加標籤, `!untag N <標籤...>`=移除標籤, `!done N`=待辦完成, `!archive N`=封存, `!priority N <high|medium|low|none>`=優先度
  - `?`/`help`/`說明`=說明
  - `!inbox` 為 `!fleeting` 的向後相容別名
- Session: 查詢結果以 [N] 編號，後續用編號操作，10 分鐘 TTL，純記憶體
- Date parsing: chrono-node zh.hant，支援「明天」「3天後」「下週一」「3/15」「清除」
- Quick reply buttons shown after each response
- Chat mode must be OFF, Webhook must be ON in LINE Official Account Manager

### MCP Server (Claude Code Integration)

- MCP server in `mcp-server/` enables Claude Code to read/write Sparkle notes via REST API
- Config: user-scoped in `~/.claude.json`
- Transport: stdio (subprocess of Claude Code)
- **Knowledge layer**: Server `instructions` auto-injected into system prompt (role definition, Zettelkasten workflow, tool usage patterns). 7 MCP Resources at `sparkle://docs/*` for deep reference. `sparkle_guide` tool as fallback.
- 10 tools: sparkle_search, sparkle_get_note, sparkle_list_notes, sparkle_create_note, sparkle_update_note, sparkle_advance_note, sparkle_export_to_obsidian, sparkle_get_stats, sparkle_list_tags, sparkle_guide
- sparkle_create_note supports all 3 types (note/todo/scratch) with priority, due, linked_note_id
- sparkle_update_note supports type conversion, priority, due, linked_note_id
- Build: `cd mcp-server && npm install && npm run build`
- Dev: `cd mcp-server && npm run dev`
- Test: `cd mcp-server && npx @modelcontextprotocol/inspector node dist/index.js`
- Registration example:
  ```bash
  claude mcp add sparkle --transport stdio --scope user \
    --env SPARKLE_AUTH_TOKEN=<token> \
    --env SPARKLE_API_URL=https://localhost:3000 \
    --env NODE_TLS_REJECT_UNAUTHORIZED=0 \
    -- node /path/to/sparkle/mcp-server/dist/index.js
  ```
- Note: Use the full node path if nvm is not available in non-interactive shells

## Data Model

### Status System

Notes follow Zettelkasten maturity: `fleeting` → `developing` → `permanent` → `exported`
Todos use simplified lifecycle: `active` → `done`
Scratch is disposable temporary storage: `draft`
Shared: `archived` (any type)

| Type | Valid Statuses | Default |
|------|---------------|---------|
| `note` | fleeting, developing, permanent, exported, archived | fleeting |
| `todo` | active, done, archived | active |
| `scratch` | draft, archived | draft |

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
- `share_visibility`: computed field in API responses — share status of the item ("public", "unlisted", or null if not shared)
- `created`/`modified`: ISO 8601 timestamps

### Type Conversion Auto-Mapping

When type changes (note ↔ todo ↔ scratch), status auto-maps server-side. Auto-mapping overrides explicit status. Due date and linked_note_id are cleared on todo→note conversion. Tags, priority, due, aliases, and linked_note_id are cleared on conversion to scratch.

### DB Migration

Schema version tracked in `schema_version` table (version 0→11). Each step is idempotent. Fresh install creates new schema directly at version 11. Migration 8→9 creates the `settings` table with Obsidian export defaults. Migration 9→10 is a no-op version bump for scratch type support (SQLite text columns need no schema change). Migration 10→11 creates the `share_tokens` table with CASCADE foreign key to items.

## Conventions

- UI language: 繁體中文
- API: REST, JSON, Bearer token auth on /api/* (except /api/webhook/), rate-limited (hono-rate-limiter)
- Startup validation: AUTH_TOKEN strength (length >= 32, Shannon entropy >= 3.0), LINE secrets (warn only)
- Graceful shutdown: SIGTERM/SIGINT → server.close() → WAL checkpoint → sqlite.close() (25s timeout)
- Node version: engines in package.json (>=22, <24), enforced by .npmrc engine-strict=true
- Tags stored as JSON array string in SQLite
- Aliases stored as JSON array string in SQLite
- Timestamps: ISO 8601 strings
- Database: SQLite WAL mode, FTS5 trigram tokenizer for search (supports Chinese)
- Tests: Vitest, in-memory SQLite, mock db module with vi.mock
- Obsidian export: .md with YAML frontmatter, local time (no TZ suffix), written to vault path. Config stored in `settings` table, read via `getObsidianSettings()`. `exportToObsidian(item, config)` is a pure function (no env dependency).
- Settings API: `GET /api/settings` returns all settings; `PUT /api/settings` accepts partial updates with Zod validation (key whitelist, vault path writability check when enabling)
- Public sharing: Notes can be shared via token-based URLs (`/s/:token`). SSR HTML pages with marked for Markdown, OpenGraph meta tags, dark mode CSS. Two visibility modes: `unlisted` (link-only) and `public` (listed in `/api/public`). Auth bypass on `/api/public/*` and `/s/*` paths. Share management via authenticated API (`/api/items/:id/share`, `/api/shares`)

## CLAUDE.md Maintenance

When making changes that affect this file's content (new features, field changes, status changes, new commands, test count changes, structural changes), **update CLAUDE.md in the same commit or a follow-up commit**. Do not wait for user to ask. Specifically update:
- Test count in Development section when tests are added/removed
- Project Structure when files are added/removed/renamed
- Data Model when schema, fields, or status system changes
- LINE Bot commands when commands are added/changed
- Environment Variables when new env vars are introduced
- Conventions when new patterns are established
