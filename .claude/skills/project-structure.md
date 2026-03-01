---
name: project-structure
description: >
  Complete annotated file tree for the Sparkle project. Maps every directory and file
  to its purpose. Use when locating files, deciding where new code goes, tracing import
  paths, or understanding relationships between server routes, lib modules, frontend
  components, scripts, and config files.
user-invocable: false
---

# Project Structure

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
    index.ts            # DB connection + schema migration (version 0→12)
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
    offline-indicator.tsx # Offline banner (uses shared useOnlineStatus hook)
    install-prompt.tsx   # PWA install banner
    __tests__/           # Frontend component tests (21 files, Testing Library + jsdom)
  lib/
    api.ts              # API client (auto-logout on 401, shares API, fetchWithRetry with timeout + exponential backoff)
    app-context.ts      # AppContext + useAppContext hook (view, nav, config, isOnline state)
    types.ts            # TypeScript interfaces + ViewType + ShareToken types
    __tests__/           # Lib unit tests (fetchWithRetry)
  hooks/
    use-keyboard-shortcuts.ts  # N=new, /=search, Esc=close
    use-online-status.ts       # Shared navigator.onLine + event hook (used by AppContext + OfflineIndicator)
    __tests__/           # Hook tests
  test-setup.ts         # Testing Library jest-dom setup
  test-utils.tsx        # renderWithContext helper for component tests
  sw.ts                 # Service worker (precache, NetworkFirst API cache, offline capture queue, skipWaiting)

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
