# Sparkle — Project Guide

## What is this

Self-hosted PWA for personal idea capture + task management with Zettelkasten note maturity flow. Quick capture on mobile, rich editing on desktop. LINE Bot integration for capturing ideas from chat. Obsidian export for permanent notes.

## Tech Stack

- **Frontend**: Vite + React 19 + TypeScript + Tailwind CSS + shadcn/ui (Radix) + code splitting (lazy-loaded routes)
- **Backend**: Hono (Node.js) + Drizzle ORM + better-sqlite3 + FTS5 + hono-rate-limiter + marked (SSR Markdown) + @sentry/node (error tracking)
- **PWA**: vite-plugin-pwa + Workbox + IndexedDB offline queue
- **Validation**: Zod on all API endpoints
- **Themes**: next-themes (dark/light)
- **Toast**: sonner
- **Icons**: lucide-react

## Project Structure

```
server/
  instrument.ts         # Sentry initialization (conditional on SENTRY_DSN, zodErrorsIntegration)
  index.ts              # Hono app, route registration, compress + cache-control + CSP middleware, HTTPS/TLS support, startup validation, graceful shutdown, health endpoint
  middleware/
    auth.ts             # Bearer token auth (skips /api/webhook/, /api/public/, /api/health)
    rate-limit.ts       # Rate limiting (API general, auth failure, webhook)
    logger.ts           # Pino HTTP request logger middleware (replaces hono's built-in)
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
    logger.ts           # Pino logger instance (JSON in prod, pino-pretty in dev)
    shutdown.ts         # Graceful shutdown (SIGTERM/SIGINT, Sentry flush, WAL checkpoint, DB close)
    safe-compare.ts     # Timing-safe string comparison (crypto.timingSafeEqual)
    settings.ts         # Settings CRUD (getSetting, getSettings, getObsidianSettings, updateSettings)
    line.ts             # LINE message/command parser
    line-format.ts      # LINE reply formatting (numbered list, detail, stats)
    line-session.ts     # LINE Bot session (numbered item mapping, in-memory)
    line-date.ts        # Natural language date parser (chrono-node zh.hant)
    shares.ts           # Share token CRUD (create, query by token/item, list, revoke)
    render-public-page.ts # SSR HTML rendering (marked, OpenGraph tags, dark mode CSS)
    health.ts           # Health check (DB ping + disk space via statfs)
  schemas/
    items.ts            # Zod validation schemas (statusEnum, excludeStatus, batch actions)
    shares.ts           # Zod schema for share creation (visibility enum)
  db/
    index.ts            # DB connection + schema migration (version 0→11)
    schema.ts           # Drizzle table schema (items + settings + share_tokens)
    fts.ts              # FTS5 virtual table + sync triggers
  test-utils.ts         # Shared test DB setup (createTestDb: in-memory SQLite + all tables + FTS)

src/
  App.tsx               # Main layout, AppContext provider, view routing, keyboard shortcuts, lazy-loaded components
  components/
    auth-gate.tsx        # Login screen
    error-boundary.tsx   # ErrorBoundary class component for lazy-loaded chunks (retry on failure)
    dashboard.tsx        # Review dashboard (Zettelkasten progress, focus, fleeting health, scratch count)
    quick-capture.tsx    # New item form (GTD quick-select tags for todos)
    item-list.tsx        # Item list + filter chips + contextual batch actions + type grouping
    item-detail.tsx      # Editor orchestrator + metadata (lazy-loaded, uses sub-components below)
    item-detail-header.tsx  # Header bar, nav, save status, action buttons, delete dialog
    item-content-editor.tsx # Content textarea + markdown preview toggle
    linked-items-section.tsx # Linked note/todo management (self-contained state)
    markdown-preview.tsx # ReactMarkdown + remarkGfm rendering (lazy-loaded, extracted from item-detail)
    item-card.tsx        # List item display with tags, linked indicators, due date, share indicators
    search-bar.tsx       # FTS search with keyword highlighting
    settings.tsx         # Settings page (Obsidian config + share management + general tools)
    share-dialog.tsx     # Share dialog (create share, copy link, revoke)
    sidebar.tsx          # Desktop nav (筆記/待辦/暫存/共用 sections + settings)
    bottom-nav.tsx       # Mobile nav (Notes, Todos, Scratch, Dashboard, Search + settings)
    fleeting-triage.tsx  # Fleeting note triage mode (發展/進行/封存/保留)
    offline-indicator.tsx
    install-prompt.tsx   # PWA install banner
    __tests__/           # Frontend component tests (Testing Library + jsdom)
  lib/
    api.ts              # API client (auto-logout on 401, shares API)
    app-context.ts      # AppContext + useAppContext hook (view, nav, config state)
    types.ts            # TypeScript interfaces + ViewType + ShareToken types
  hooks/
    use-keyboard-shortcuts.ts  # N=new, /=search, Esc=close
  test-setup.ts         # Testing Library jest-dom setup
  test-utils.tsx        # renderWithContext helper for component tests
  sw.ts                 # Service worker (offline capture queue)

scripts/
  start.sh              # One-command restart (uses systemctl)
  install-services.sh   # Install systemd services
  setup-cloudflared.sh  # Cloudflare Tunnel setup (interactive, plain HTTP default)
  setup-backup.sh       # Restic backup one-time setup (interactive)
  backup.sh             # Automated DB backup (cron-compatible)
  health-monitor.sh     # Health check + LINE alert (cron-compatible, dedup via flag file)
  error-summary.sh      # Hourly error log summary + LINE alert (journalctl + jq)
  firewall.sh           # iptables setup (atomic all-or-nothing, graceful skip if unavailable)
  firewall-cleanup.sh   # iptables cleanup on service stop
  cloudflared-config.yml.template  # Tunnel config template (plain HTTP default, HTTPS optional)
  systemd/
    sparkle.service         # Node.js server (HTTP or HTTPS)
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
      write.ts            # sparkle_create_note, sparkle_update_note (note/todo/scratch, full field support, partial edit via old_content)
      workflow.ts         # sparkle_advance_note, sparkle_export_to_obsidian
      meta.ts             # sparkle_get_stats, sparkle_list_tags
      guide.ts            # sparkle_guide (documentation query by topic)

e2e/
  auth.setup.ts          # Playwright auth setup (login + save storageState)
  basic-flow.spec.ts     # E2E tests: login, quick capture, search, item detail
  .auth/                 # Generated auth state (gitignored)

playwright.config.ts    # Playwright config (Chromium-only, auto-starts Hono server on :3456, temp test DB)
eslint.config.js        # ESLint 9 flat config (typescript-eslint, react-hooks, prettier compat)
.prettierrc             # Prettier config (double quotes, trailing commas, 100 char width)
.prettierignore         # Prettier ignore (dist, node_modules, coverage, data, certs, mcp-server)
.husky/
  pre-commit            # CLAUDE.md update warning + lint-staged
.github/
  dependabot.yml        # Dependabot config (weekly npm + GitHub Actions updates)
  workflows/
    ci.yml              # GitHub Actions CI (lint, format, type-check, build, unit test, E2E Playwright on Node 22)
    deploy.yml          # Auto-deploy on main push (workflow_run after CI, self-hosted runner)
    release.yml         # Release-Please (auto CHANGELOG + GitHub Release on conventional commits)

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

# Tests (660 tests, 35 files — server 470 + frontend 190)
npx vitest run                # Run all tests
npm run test:coverage         # With coverage report (thresholds: 80% statements, 75% branches)
npx vitest                    # Watch mode
# Coverage: ~84% statements, ~85% branches. server/lib ~97%, server/routes ~94%. All frontend components tested. Thresholds enforced in CI (statements 80%, branches 75%).

# E2E tests (Playwright, Chromium-only, requires dist/ build)
npm run test:e2e     # Run E2E tests (auto-starts server on :3456 with temp DB)
npm run test:e2e:ui  # Playwright UI mode for debugging

# Linting & formatting
npm run lint         # ESLint check (src/ + server/)
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier write
npm run format:check # Prettier check (CI uses this)

# Build
npm run build        # Production frontend → dist/
```

**Note:** Auto-deploy (`deploy.yml`) runs `npm run build` on the self-hosted runner, so you no longer need to build locally before committing. Build locally only when testing production mode.

## Production Deployment

Self-hosted on WSL2 (mirrored networking mode) with WireGuard VPN. Managed by systemd. See `docs/self-hosting.md` for full setup instructions.

### Auto-Deploy (GitHub Actions)

- `deploy.yml` triggers via `workflow_run` after CI passes on `main`
- Runs on a **self-hosted runner** inside WSL2 (same machine as production)
- Steps: `git pull` → `npm ci` → `npm run build` → `systemctl restart sparkle` → health check
- **One-time setup required**: install self-hosted runner (`~/actions-runner/`), service name `actions.runner.hottim900-sparkle.sparkle-wsl`, configure sudoers (`/etc/sudoers.d/github-runner`) for passwordless `systemctl restart sparkle`
- Rollback: `git revert` + push triggers a new deploy

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

Copy `.env.example` to `.env` and fill in your values. See `.env.example` for all available variables. Key optional variables: `SENTRY_DSN` (error tracking), `TLS_CERT`/`TLS_KEY` (HTTPS), `LINE_CHANNEL_SECRET`/`LINE_CHANNEL_ACCESS_TOKEN` (LINE Bot), `LINE_ADMIN_USER_ID` (monitoring alerts).

### HTTPS (mkcert) — Optional

- When behind Cloudflare Tunnel, plain HTTP on localhost is recommended (no TLS overhead)
- TLS is only needed for direct LAN access without a tunnel
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

### Monitoring (LINE Push Alerts)

- `scripts/health-monitor.sh`: Health check via `curl /api/health`. First failure sends LINE alert, subsequent failures suppressed via `/tmp/sparkle-health-alert-sent` flag file. Recovery clears flag and sends recovery notification.
- `scripts/error-summary.sh`: Scans `journalctl -u sparkle` for pino ERROR (level 50) and FATAL (level 60) in the past hour. Sends LINE push summary if count > 0. Requires `jq`.
- Both scripts read `LINE_CHANNEL_ACCESS_TOKEN` and `LINE_ADMIN_USER_ID` from `.env`. Missing vars = silent exit.
- LINE Push Message API: `POST https://api.line.me/v2/bot/message/push` with Bearer token auth
- Suggested cron:
  - `*/5 * * * * /home/tim/sparkle/scripts/health-monitor.sh 2>&1 | logger -t sparkle-health`
  - `0 * * * * /home/tim/sparkle/scripts/error-summary.sh 2>&1 | logger -t sparkle-errors`

### Cloudflare Tunnel + Access

- Run `scripts/setup-cloudflared.sh` for interactive setup (new tunnel only; existing tunnels already have separate configs)
- **Default: plain HTTP** between cloudflared and Sparkle (both on localhost, TLS unnecessary)
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
- sparkle_update_note supports type conversion, priority, due, linked_note_id, partial content edit (old_content + content for find-and-replace)
- Build: `cd mcp-server && npm install && npm run build`
- Dev: `cd mcp-server && npm run dev`
- Test: `cd mcp-server && npx @modelcontextprotocol/inspector node dist/index.js`
- Registration example:
  ```bash
  claude mcp add sparkle --transport stdio --scope user \
    --env SPARKLE_AUTH_TOKEN=<token> \
    --env SPARKLE_API_URL=http://localhost:3000 \
    -- node /path/to/sparkle/mcp-server/dist/index.js
  ```
- If Sparkle uses HTTPS (direct LAN access without tunnel), add `--env NODE_TLS_REJECT_UNAUTHORIZED=0` and change URL to `https://`
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
- API: REST, JSON, Bearer token auth on /api/* (except /api/webhook/, /api/public/, /api/health), rate-limited (hono-rate-limiter)
- Startup validation: AUTH_TOKEN strength (length >= 32, Shannon entropy >= 3.0), LINE secrets (warn only)
- Graceful shutdown: SIGTERM/SIGINT → server.close() → Sentry.close() → WAL checkpoint → sqlite.close() (25s timeout)
- Node version: engines in package.json (>=22, <24), enforced by .npmrc engine-strict=true
- Tags stored as JSON array string in SQLite
- Aliases stored as JSON array string in SQLite
- Timestamps: ISO 8601 strings
- Database: SQLite WAL mode, FTS5 trigram tokenizer for search (supports Chinese)
- Tests: Vitest with projects config (server=node, frontend=jsdom). Server: in-memory SQLite, mock db module with vi.mock, shared `createTestDb()` in `server/test-utils.ts`. Frontend: Testing Library + jest-dom, `renderWithContext()` helper in `src/test-utils.tsx` for components using AppContext. E2E: Playwright (Chromium-only) against production build (`dist/`), Hono server on port 3456 with temp SQLite DB (`/tmp/sparkle-e2e-test.db`), auth via storageState. 7 tests covering login, note/todo creation, search, item detail. Test files excluded from tsconfig (both `tsconfig.json` and `tsconfig.server.json`) — Vitest handles test file type-checking via its own config.
- Obsidian export: .md with YAML frontmatter, local time (no TZ suffix), written to vault path. Config stored in `settings` table, read via `getObsidianSettings()`. `exportToObsidian(item, config)` is a pure function (no env dependency).
- Settings API: `GET /api/settings` returns all settings; `PUT /api/settings` accepts partial updates with Zod validation (key whitelist, vault path writability check when enabling)
- Public sharing: Notes can be shared via token-based URLs (`/s/:token`). SSR HTML pages with marked for Markdown, OpenGraph meta tags, dark mode CSS. Two visibility modes: `unlisted` (link-only) and `public` (listed in `/api/public`). Auth bypass on `/api/public/*` and `/s/*` paths. Share management via authenticated API (`/api/items/:id/share`, `/api/shares`)
- Performance: gzip/deflate compression via `hono/compress` on all responses with `Vary: Accept-Encoding` for CDN cache correctness. Static assets (`/assets/*`) served with `Cache-Control: immutable` (Vite content-hashed filenames). Frontend uses code splitting — heavy components (ItemDetail, Settings, Dashboard, FleetingTriage, MarkdownPreview) are lazy-loaded via `React.lazy()` with `ErrorBoundary` wrappers for chunk load failure recovery. Vendor chunks split: `ui` (radix + cva), `markdown` (react-markdown + remark-gfm)
- Logging: pino structured logger (`server/lib/logger.ts`). JSON output in production, pino-pretty in dev. Custom HTTP request logger middleware replaces hono's built-in. Health check requests logged at debug level. All server `console.log/error/warn` replaced with `logger.info/error/warn`.
- Error tracking: Sentry via `@sentry/node` with official Hono integration. `server/instrument.ts` initializes conditionally (only when `SENTRY_DSN` is set). `Sentry.setupHonoErrorHandler(app)` auto-captures server errors (skips 3xx/4xx). `zodErrorsIntegration` captures structured Zod validation errors. Graceful shutdown flushes pending events via `Sentry.close(2000)`.
- Security: Content-Security-Policy header on all responses (self-only scripts/fonts/connect, unsafe-inline styles for Tailwind, HTTPS images, frame-ancestors none). Health endpoint (`GET /api/health`) unauthenticated for Docker/orchestrator monitoring. Returns `{ status, checks: { db, disk }, uptime }` — HTTP 200 when ok, 503 when degraded (DB unreachable or disk < 100MB).
- State management: AppContext (`src/lib/app-context.ts`) provides view state, navigation, config, and refresh to child components via `useAppContext()`. Sidebar, BottomNav use context only (0 props). ItemDetail split into sub-components: ItemDetailHeader, ItemContentEditor, LinkedItemsSection.
- Linting: ESLint 9 flat config with typescript-eslint (recommended), react-hooks plugin, eslint-config-prettier. Test files relaxed (`no-explicit-any` warn, `no-require-imports` off). Unused vars allowed with `_` prefix.
- Formatting: Prettier (double quotes, trailing commas, 100 char width). Enforced via lint-staged + Husky pre-commit hook. `.prettierignore` excludes dist, mcp-server, data, certs.
- CI: GitHub Actions on push/PR to main — npm audit → lint → format:check → tsc (frontend + server) → build → unit test → E2E (Playwright Chromium). Artifacts: playwright-report + test-results (7 days). Node 22 pinned. Job timeout: 15 minutes.
- CD: Auto-deploy on main push via `deploy.yml` (workflow_run trigger, self-hosted runner in WSL2). Steps: git pull → npm ci → build → restart → health check (retry loop, 5 attempts).
- Dependabot: weekly npm updates (root + mcp-server) + GitHub Actions version updates. Dev dependency minor/patch grouped, production patch-only grouped. Config at `.github/dependabot.yml`.
- Commit conventions: commitlint with `@commitlint/config-conventional`. Enforced via `.husky/commit-msg` hook. Allowed types: feat, fix, docs, chore, refactor, test, perf, ci, build, style, revert.
- Release: Release-Please (`release.yml`) auto-creates Release PR on push to main when feat/fix commits are detected. Merging the PR bumps `package.json` version, updates `CHANGELOG.md`, and publishes a GitHub Release with semantic version tag.
- MCP server tests: Vitest in `mcp-server/`, 43 tests (format helpers + API client + tool handlers). Run with `cd mcp-server && npm test`.

## CLAUDE.md Maintenance

When making changes that affect this file's content (new features, field changes, status changes, new commands, test count changes, structural changes), **update CLAUDE.md in the same commit or a follow-up commit**. Do not wait for user to ask. Specifically update:
- Test count in Development section when tests are added/removed
- Project Structure when files are added/removed/renamed
- Data Model when schema, fields, or status system changes
- LINE Bot commands when commands are added/changed
- Environment Variables when new env vars are introduced
- Conventions when new patterns are established
