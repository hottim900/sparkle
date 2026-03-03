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

## Development

```bash
# Start dev servers (two terminals)
npm run dev          # Vite on :5173, proxies /api to :3000
npm run dev:server   # Hono on :3000 with tsx watch

# Tests require node v22 (better-sqlite3 native module)
nvm use 22
npx vitest run       # Unit tests (707 tests, 37 files)
npm run test:e2e     # E2E tests (Playwright, requires build)

# Linting & formatting
npm run lint         # ESLint check (src/ + server/)
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier write
npm run format:check # Prettier check (CI uses this)

# Build
npm run build        # Production frontend → dist/
```

Auto-deploy (`deploy.yml`) runs `npm run build` on the self-hosted runner. See `/ops` skill for production deployment. See `/testing` skill for detailed test architecture and patterns.

## Data Model

### Status System

Notes follow Zettelkasten maturity: `fleeting` → `developing` → `permanent` → `exported`
Todos use simplified lifecycle: `active` → `done`
Scratch is disposable temporary storage: `draft`
Shared: `archived` (any type)

| Type      | Valid Statuses                                      | Default  |
| --------- | --------------------------------------------------- | -------- |
| `note`    | fleeting, developing, permanent, exported, archived | fleeting |
| `todo`    | active, done, archived                              | active   |
| `scratch` | draft, archived                                     | draft    |

### Field Names (Obsidian-aligned)

```
id, type, title, content, status, priority, due, tags, origin, source, aliases, linked_note_id, category_id, created, modified
```

- `origin`: capture channel (LINE, web, import)
- `source`: reference URL (nullable)
- `aliases`: alternative names for Obsidian linking (JSON array)
- `due`: YYYY-MM-DD format, **todo-only** (notes ignore due; todo→note conversion clears due)
- `linked_note_id`: todo→note reference (nullable, todo-only; cleared on todo→note conversion; FK with ON DELETE SET NULL — deleting the referenced note auto-nullifies)
- `linked_todo_count`: computed field in API responses — number of non-archived todos linked to a note (0 for todos)
- `linked_note_title`: computed field in API responses — title of linked note for todos (null if none)
- `category_id`: browsing group (nullable FK → categories, ON DELETE SET NULL). Preserved across all type conversions.
- `category_name`: computed field in API responses — name of assigned category (null if none)
- `share_visibility`: computed field in API responses — share status of the item ("public", "unlisted", or null if not shared)
- `created`/`modified`: ISO 8601 timestamps

### Type Conversion Auto-Mapping

When type changes (note ↔ todo ↔ scratch), status auto-maps server-side. Auto-mapping overrides explicit status. Due date and linked_note_id are cleared on todo→note conversion. Tags, priority, due, aliases, and linked_note_id are cleared on conversion to scratch. `category_id` is preserved across all type conversions (browsing aid, not type-dependent).

DB migration: version 0→13, idempotent steps. Claude auto-loads the conventions-detail skill for full migration history when relevant.

## Conventions

- UI language: 繁體中文
- Node version: engines in package.json (>=22, <24), enforced by .npmrc engine-strict=true
- Database: SQLite WAL mode, FTS5 trigram tokenizer for search (supports Chinese)
- Tags stored as JSON array string in SQLite
- Aliases stored as JSON array string in SQLite
- Timestamps: ISO 8601 strings
- API: REST, JSON, Bearer token auth on /api/\* (except /api/webhook/, /api/public/, /api/health), rate-limited
- Linting: ESLint 9 flat config with typescript-eslint (recommended), react-hooks plugin, eslint-config-prettier. Test files relaxed (`no-explicit-any` warn, `no-require-imports` off). Unused vars allowed with `_` prefix.
- Formatting: Prettier (double quotes, trailing commas, 100 char width). Enforced via lint-staged + Husky pre-commit. `.prettierignore` excludes dist, mcp-server, data, certs.
- Commit conventions: commitlint with `@commitlint/config-conventional`. Enforced via `.husky/commit-msg` hook. Allowed types: feat, fix, docs, chore, refactor, test, perf, ci, build, style, revert
- 分支策略：**所有 code 改動必須在 feature branch 上進行，禁止直接 commit 到 main。** GitHub ruleset 已啟用（main 要求 PR + `test` CI 通過才能 merge，squash merge only）。pre-commit hook 會阻擋在 main 上的 commit。不論是人、Claude Code session、或 agent/teammate，一律建立 feature branch 再開 PR。命名慣例：`{type}/{short-description}`（如 `feat/offline-queue`、`fix/migration-null`）。PR 標題必須符合 conventional commit 格式（如 `feat: add offline queue`），因為 squash merge 用 PR 標題作為 commit message。
- PR 原則：按風險隔離切分。DB migration 永遠獨立 PR。不同風險等級（DB schema / 後端邏輯 / 純前端 / CI config）不混在同一個 PR。同風險等級的相關改動可以合併。
- Merge 策略：使用 `gh pr merge --squash --auto` 啟用 auto-merge，CLI 立即返回，GitHub 在 CI 通過後自動 merge（避免阻塞等待）。高風險先行，驗證後再繼續。DB migration PR merge 後必須等 deploy + health check 通過才 merge 下一個。低風險 PR（純前端、CI config）可以連續 merge。不要在離開前 merge 高風險 PR。
- Migration 安全：PostToolUse hook (`.claude/hooks/migration-safety.sh`) 在編輯 `server/db/index.ts` 時自動檢查：(1) 禁止 `SELECT *` in migration INSERT (2) DROP TABLE 必須搭配 `foreign_keys = OFF` (3) `setSchemaVersion` 不可在 transaction 內。對 agent/teammate 也生效。
- Agent/Teammate 開發規範：**(0) 第一個動作：驗證不在 main 上**（`git branch --show-current` 不是 `main`，或 `git rev-parse --show-toplevel` 指向 `.claude/worktrees/`）。未驗證前不做任何 code 改動。(1) commit 前必須執行 `npm run lint:fix && npm run format` 消除 unused imports 等殘留 (2) 必須在 worktree 或 feature branch 上工作 (3) 完成後開 PR，不直接 push main。如果意外 commit 到 main：`git checkout -b feat/xxx && git push -u origin feat/xxx`，然後 `git checkout main && git reset --hard origin/main`。

For detailed conventions on specific modules (API retry, Performance, PWA, Logging, Sentry, CSP, Offline UI, State management, CI/CD, Sharing, Export), Claude auto-loads the conventions-detail skill when relevant.

## Skills Reference

Available skills for this project (invoke with `/skill-name` or auto-loaded by Claude):

| Skill              | Invoke        | Description                        |
| ------------------ | ------------- | ---------------------------------- |
| project-structure  | auto          | Full annotated file tree           |
| testing            | `/testing`    | Test architecture, patterns, E2E   |
| ops                | `/ops`        | Production deployment & operations |
| line-bot           | `/line-bot`   | LINE Bot commands & integration    |
| mcp-server         | `/mcp-server` | MCP server for Claude Code         |
| conventions-detail | auto          | Detailed module conventions        |

## Maintenance

When making changes that affect documentation, **update the relevant file in the same commit or follow-up commit**:

- **CLAUDE.md**: Core conventions, data model, dev commands, Skills Reference table
- **`.claude/skills/project-structure.md`**: When files are added/removed/renamed
- **`.claude/skills/testing.md`**: When tests are added/removed or test infra changes
- **`.claude/skills/ops.md`**: When deployment/infra changes
- **`.claude/skills/line-bot.md`**: When LINE Bot commands change
- **`.claude/skills/mcp-server.md`**: When MCP server tools/config changes
- **`.claude/skills/conventions-detail.md`**: When module-specific conventions change
