# Sparkle — Project Guide

Self-hosted PWA: idea capture + task management with Zettelkasten maturity flow, LINE Bot, Obsidian vault integration, daily note generation.

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
# MCP server (in mcp-server/)
cd mcp-server && npm run dev:http  # MCP HTTP server on :3001 (Claude.ai connector)
cd mcp-server && npm run dev       # MCP stdio server (Claude Code, launched automatically)
```

See `/testing` for test architecture. See `/ops` for deployment.

## Data Model

Notes: `fleeting` → `developing` → `permanent` → `exported` → `archived`. Todos: `active` → `done` → `archived`. Scratch: `draft` → `archived`. Full field reference in `conventions-detail` skill (invoke `/conventions-detail` for field reference).

Type conversion auto-maps status server-side. `category_id` preserved; `due`/`linked_note_id` cleared on todo→note; tags/priority/aliases cleared on →scratch.

DB migration version 0→15, idempotent. Migration safety enforced by PostToolUse hook.

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

- 新 dashboard query：**必須比對既有 query 的 WHERE 條件**（`is_private = 0`、status 過濾、type 過濾），確保一致。
- 新 route：必須有獨立的 route validation 測試（不依賴純 function unit test 覆蓋）。

Detailed module conventions (API retry, PWA, Logging, Sentry, CSP, Offline UI, State management, CI/CD, Sharing, Export, Data Model fields) — see `conventions-detail` skill.

## Feature Workflow

新功能開發流程（**先建 branch，再 review**）：

1. `git checkout -b feat/xxx`（或 worktree）
2. 設計：`/office-hours` → design doc
3. Review：`/autoplan` 或個別 review skills（在 feature branch 上跑，review log 才會對齊）
4. 實作 + 測試
5. `/ship` 出 PR → `gh pr merge --squash --auto`

**Ship 前檢查**：`/ship` 內建 pre-landing review，但大功能（500+ LOC）建議先跑 `/review` 再 `/ship`，減少 ship 後的 fix commits。

## Quality Management

品質追蹤系統（Defect / Tech Debt / Feature Gap / Test Infrastructure）。**操作前必須載入 `/quality` skill**。

## Skills Reference

| Skill              | Invoke                | Description                        |
| ------------------ | --------------------- | ---------------------------------- |
| project-structure  | auto                  | Full annotated file tree           |
| testing            | `/testing`            | Test architecture, patterns, E2E   |
| ops                | `/ops`                | Production deployment & operations |
| line-bot           | `/line-bot`           | LINE Bot commands & integration    |
| mcp-server         | `/mcp-server`         | MCP server (stdio + HTTP/OAuth)    |
| conventions-detail | `/conventions-detail` | Detailed module conventions        |
| quality            | `/quality`            | Quality tracking system operations |

## gstack

Use /browse from gstack for all web browsing. Never use mcp**claude-in-chrome**\* tools.
Available skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /design-consultation, /review, /ship, /land-and-deploy, /canary, /benchmark, /browse, /qa, /qa-only, /design-review, /setup-browser-cookies, /setup-deploy, /retro, /investigate, /document-release, /codex, /cso, /autoplan, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade.

## Maintenance

Update docs in same commit: **CLAUDE.md** (core conventions). Skills (`.claude/skills/`) are local-only (gitignored).
