# Sparkle — Project Guide

Self-hosted PWA: idea capture + task management with Zettelkasten maturity flow, LINE Bot, Obsidian export.

## Development

```bash
npm run dev          # Vite on :5173, proxies /api to :3000
npm run dev:server   # Hono on :3000 with tsx watch
nvm use 22           # Required for better-sqlite3 native module
npx vitest run       # Unit tests
npm run test:e2e     # E2E tests (requires build)
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier write
npm run build        # Production frontend → dist/
```

See `/testing` for test architecture. See `/ops` for deployment.

## Data Model

Notes: `fleeting` → `developing` → `permanent` → `exported` → `archived`. Todos: `active` → `done` → `archived`. Scratch: `draft` → `archived`. Full field reference in `conventions-detail` skill (invoke `/conventions-detail` for field reference).

Type conversion auto-maps status server-side. `category_id` preserved; `due`/`linked_note_id` cleared on todo→note; tags/priority/aliases cleared on →scratch.

DB migration version 0→13, idempotent. Migration safety enforced by PostToolUse hook.

## Conventions

- UI language: 繁體中文
- Node >=22 <24, enforced by `.npmrc engine-strict=true`
- SQLite WAL mode, FTS5 trigram tokenizer (Chinese support)
- Commit: `@commitlint/config-conventional` via `.husky/commit-msg`. Types: feat, fix, docs, chore, refactor, test, perf, ci, build, style, revert
- Worktree 開發：**此機器同時是開發和生產環境，main working directory 必須留在 main branch。** 所有 session 用 `claude --worktree`，agent 用 `isolation: "worktree"`。
- 分支策略：**禁止直接 commit 到 main。** 一律 feature branch → PR → squash merge。命名：`{type}/{short-description}`。PR 標題必須符合 conventional commit 格式。
- PR 原則：按風險隔離。DB migration 獨立 PR。不同風險等級不混合。
- Merge：`gh pr merge --squash --auto`。DB migration PR merge 後等 deploy + health check 通過才繼續。
- Session 管理：不相關任務之間用 `/clear` 重置 context。長 session 品質下降時 `/compact` 或 `/clear`。
- Agent/Teammate：**(0) 驗證不在 main 上** (1) commit 前 `npm run lint:fix && npm run format && npx tsc --noEmit` (2) 在 worktree 或 feature branch 工作 (3) 完成後開 PR。

Detailed module conventions (API retry, PWA, Logging, Sentry, CSP, Offline UI, State management, CI/CD, Sharing, Export, Data Model fields) — see `conventions-detail` skill.

## Quality Management

品質追蹤系統（Defect / Tech Debt / Feature Gap）。**操作前必須載入 `/quality` skill**。

## Skills Reference

| Skill              | Invoke                | Description                        |
| ------------------ | --------------------- | ---------------------------------- |
| project-structure  | auto                  | Full annotated file tree           |
| testing            | `/testing`            | Test architecture, patterns, E2E   |
| ops                | `/ops`                | Production deployment & operations |
| line-bot           | `/line-bot`           | LINE Bot commands & integration    |
| mcp-server         | `/mcp-server`         | MCP server for Claude Code         |
| conventions-detail | `/conventions-detail` | Detailed module conventions        |
| quality            | `/quality`            | Quality tracking system operations |

## Maintenance

Update docs in same commit: **CLAUDE.md** (core conventions), **`docs/plans/quality/README.md`** (quality items). Skills (`.claude/skills/`) are local-only (gitignored).
