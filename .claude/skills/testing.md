---
name: testing
description: >
  Test architecture, configuration, and patterns for Sparkle. Vitest unit tests
  (server + frontend 707 tests), Playwright E2E tests (29 tests), coverage thresholds,
  mock patterns (vi.mock, createTestDb, renderWithContext), E2E helpers and flakiness
  workarounds, MCP server tests. Use when writing tests, debugging test failures,
  or modifying test infrastructure.
user-invocable: true
---

# Testing

## Quick Reference

```bash
# Tests require node v22 (better-sqlite3 native module is incompatible with v24)
nvm use 22

# Unit tests (707 tests, 37 files — server 475 + frontend 232)
npx vitest run                # Run all tests
npm run test:coverage         # With coverage report (thresholds: 75% statements, 70% branches)
npx vitest                    # Watch mode
# Coverage: ~78% statements, ~74% branches (Vitest 4 V8 remapping). server/lib ~97%, server/routes ~94%. All frontend components tested. Thresholds enforced in CI (statements 75%, branches 70%).

# E2E tests (Playwright, Chromium-only, requires dist/ build)
npm run test:e2e     # Run E2E tests (auto-starts server on :3456 with temp DB)
npm run test:e2e:ui  # Playwright UI mode for debugging

# MCP server tests (43 tests)
cd mcp-server && npm test
```

## Unit Test Architecture

- Vitest with projects config (server=node, frontend=jsdom)
- Coverage: ~78% statements, ~74% branches (Vitest 4 V8 remapping); thresholds enforced in CI (75% statements, 70% branches)
- Coverage excludes: shadcn/ui, api.ts (always mocked), App.tsx, sw.ts

### Server Tests

- In-memory SQLite, mock db module with vi.mock
- Shared `createTestDb()` in `server/test-utils.ts`

### Frontend Tests

- Testing Library + jest-dom + userEvent
- `renderWithContext()` helper in `src/test-utils.tsx` for components using AppContext
- All frontend components and hooks tested (22 test files, 232 tests)
- `vi.mock("@/lib/api")` with top-level mock variables (e.g., `const mockListItems = vi.fn()`)
- `vi.mock("sonner")` for toast assertions
- `vi.useFakeTimers()` for debounce tests (1500ms auto-save)

## E2E Test Architecture

- Playwright (Chromium desktop + iPhone 14 mobile, serial `workers: 1`) against production build (`dist/`)
- Hono server on port 3456 with temp SQLite DB (`/tmp/sparkle-e2e-test.db`)
- Auth via storageState, `RATE_LIMIT_MAX=10000` for test server
- 29 tests across 6 spec files (24 desktop + 5 mobile)
- Shared helpers in `e2e/helpers.ts`

### Coverage

- login, quick capture, search, item detail
- item lifecycle CRUD (edit title/content, status change, tags, delete, type conversion)
- note triage workflow (develop/archive/skip), note maturity progression
- todo priority/due/done, linked todo create/navigate
- settings page, theme toggle, data export
- Mobile (`e2e/mobile.spec.ts`): bottom nav, quick capture, tag + button, item detail, search

### E2E Patterns & Flakiness Notes

- `waitForResponse` for PATCH save verification
- Radix Select options render in portal to `<body>` — use `page.getByRole("option")` globally, not scoped to trigger parent
- Auto-save debounce: use `blur()` to trigger immediate save or `waitForResponse` for PATCH. Don't rely solely on "已儲存" text which may be ambiguous
- Different ports for parallel E2E agents (3457, 3458)
- Parallel workers + shared DB = flaky. Fixed by `workers: 1`
- Rate limiting in E2E: 200 req/min default too low. Fixed by `RATE_LIMIT_MAX` env var (set to 10000 in playwright.config.ts)

### Test File Config

- Test files excluded from tsconfig (both `tsconfig.json` and `tsconfig.server.json`) — Vitest handles test file type-checking via its own config

## MCP Server Tests

- Vitest in `mcp-server/`, 43 tests (format helpers + API client + tool handlers)
- Run with `cd mcp-server && npm test`
