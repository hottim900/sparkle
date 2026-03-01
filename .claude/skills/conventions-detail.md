---
name: conventions-detail
description: >
  Detailed implementation conventions for specific Sparkle modules: API client retry/timeout
  (fetchWithRetry), Performance and cache-control, PWA/Service Worker caching (Workbox),
  pino logging, Sentry error tracking, CSP header, offline UI (useOnlineStatus), AppContext
  state management, public sharing (SSR/OpenGraph), Obsidian export, Settings API, CI/CD
  pipeline, Dependabot, Release-Please, DB migration history. Use when modifying these subsystems.
user-invocable: false
---

# Conventions — Detailed Reference

## API Client

REST, JSON, Bearer token auth on /api/* (except /api/webhook/, /api/public/, /api/health), rate-limited (hono-rate-limiter). Frontend API client (`src/lib/api.ts`) includes 15s AbortController timeout and automatic retry (max 3 attempts) with exponential backoff + jitter. GET/DELETE retry on network errors and 5xx; POST/PATCH/PUT retry only on network errors (not 5xx). 4xx errors are never retried. Timeout errors throw `ApiClientError` with status 0.

## Server Lifecycle

### Startup Validation

AUTH_TOKEN strength (length >= 32, Shannon entropy >= 3.0), LINE secrets (warn only).

### Graceful Shutdown

SIGTERM/SIGINT → server.close() → Sentry.close() → WAL checkpoint → sqlite.close() (25s timeout).

## Obsidian Export

.md with YAML frontmatter, local time (no TZ suffix), written to vault path. Config stored in `settings` table, read via `getObsidianSettings()`. `exportToObsidian(item, config)` is a pure function (no env dependency).

## Settings API

`GET /api/settings` returns all settings; `PUT /api/settings` accepts partial updates with Zod validation (key whitelist, vault path writability check when enabling).

## Public Sharing

Notes can be shared via token-based URLs (`/s/:token`). SSR HTML pages with marked for Markdown, OpenGraph meta tags, dark mode CSS. Two visibility modes: `unlisted` (link-only) and `public` (listed in `/api/public`). Auth bypass on `/api/public/*` and `/s/*` paths. Share management via authenticated API (`/api/items/:id/share`, `/api/shares`).

## Performance

gzip/deflate compression via `hono/compress` on all responses with `Vary: Accept-Encoding` for CDN cache correctness. Static assets (`/assets/*`) served with `Cache-Control: immutable` (Vite content-hashed filenames). API responses (`/api/*`) served with `Cache-Control: no-store` to prevent browser heuristic caching. Frontend `fetchWithRetry` also sets `cache: "no-store"` as double insurance. Frontend uses code splitting — heavy components (ItemDetail, Settings, Dashboard, FleetingTriage, MarkdownPreview) are lazy-loaded via `React.lazy()` with `ErrorBoundary` wrappers for chunk load failure recovery. Vendor chunks split: `ui` (radix + cva), `markdown` (react-markdown + remark-gfm).

## PWA Caching

Service Worker uses Workbox `injectManifest` strategy. Static assets precached via `precacheAndRoute(self.__WB_MANIFEST)`. GET `/api/*` requests use `NetworkFirst` strategy (cacheName: `api-cache`, 10s network timeout, only caches 200 responses) — online always fetches fresh data, offline falls back to last cached response. POST `/api/items` intercepted for offline queue (IndexedDB, replayed on reconnect). SW updates use `skipWaiting()` + `clientsClaim()` for immediate activation; main.tsx detects `controllerchange` and auto-reloads. Periodic update check every 60 minutes via `reg.update()`.

## Logging

pino structured logger (`server/lib/logger.ts`). JSON output in production, pino-pretty in dev. Custom HTTP request logger middleware replaces hono's built-in. Health check requests logged at debug level. All server `console.log/error/warn` replaced with `logger.info/error/warn`.

## Error Tracking (Sentry)

Sentry via `@sentry/node` with official Hono integration. `server/instrument.ts` initializes conditionally (only when `SENTRY_DSN` is set). `Sentry.setupHonoErrorHandler(app)` auto-captures server errors (skips 3xx/4xx). `zodErrorsIntegration` captures structured Zod validation errors. Graceful shutdown flushes pending events via `Sentry.close(2000)`.

## Security (CSP)

Content-Security-Policy header on all responses (self-only scripts/fonts/connect, unsafe-inline styles for Tailwind, HTTPS images, frame-ancestors none). Health endpoint (`GET /api/health`) unauthenticated for Docker/orchestrator monitoring. Returns `{ status, checks: { db, disk }, uptime }` — HTTP 200 when ok, 503 when degraded (DB unreachable or disk < 100MB).

## Offline UI

"Honest about limitations" approach — when offline, all mutating operations (save, delete, status change, export, share) are disabled with clear feedback (disabled buttons + toast messages in 繁體中文). Quick capture stays functional via existing SW queue. `useOnlineStatus()` hook shared across components via AppContext (`isOnline`). Components read from context; standalone components (Settings, FleetingTriage) use the hook directly.

## State Management

AppContext (`src/lib/app-context.ts`) provides view state, navigation, config, isOnline, and refresh to child components via `useAppContext()`. Sidebar, BottomNav use context only (0 props). ItemDetail split into sub-components: ItemDetailHeader, ItemContentEditor, LinkedItemsSection.

## CI Pipeline

GitHub Actions on push/PR to main — npm audit → lint → format:check → tsc (frontend + server) → build → unit test with coverage (thresholds enforced) → E2E (Playwright Chromium). Artifacts: playwright-report + test-results (7 days). Node 22 pinned. Job timeout: 15 minutes.

## CD (Auto-Deploy)

Auto-deploy on main push via `deploy.yml` (workflow_run trigger, self-hosted runner in WSL2). Steps: git pull → npm ci → build → validate migrations against production DB → restart → health check (retry loop, 5 attempts). Migration validation runs `import './server/db/index.js'` before restart — if migration crashes, deploy aborts and old service stays running.

## Dependabot

Weekly npm updates (root + mcp-server) + GitHub Actions version updates. Dev dependency minor/patch grouped, production patch-only grouped. Config at `.github/dependabot.yml`.

## Release

Release-Please (`release.yml`) auto-creates Release PR on push to main when feat/fix commits are detected. Merging the PR bumps `package.json` version, updates `CHANGELOG.md`, and publishes a GitHub Release with semantic version tag. Release PR 在自然里程碑 merge，不隨 session 結束。

## DB Migration

Schema version tracked in `schema_version` table (version 0→12). Each step is idempotent. Fresh install creates new schema directly at version 12. Migration 8→9 creates the `settings` table with Obsidian export defaults. Migration 9→10 is a no-op version bump for scratch type support (SQLite text columns need no schema change). Migration 10→11 creates the `share_tokens` table with CASCADE foreign key to items. Migration 11→12 adds FK constraint on `linked_note_id` with ON DELETE SET NULL (requires table recreation; cleans up orphan references, recreates indexes, FTS triggers rebuilt by setupFTS).
