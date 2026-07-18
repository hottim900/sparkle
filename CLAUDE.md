# Sparkle — Project Guide

Self-hosted PKM frontend for Obsidian: quick capture (LINE Bot / PWA) → Zettelkasten maturity → vault export. Includes task management, daily note generation, and temporal bridge (week view + LINE daily brief).

## Product Positioning

Sparkle 是 Obsidian 的活躍前端，不是獨立 PKM。Sparkle 負責捕捉、分類、任務管理；Obsidian 負責深度閱讀與反思。功能決策原則：

- **加深與 Obsidian 的連結**，而非在 Sparkle 內重建 Obsidian 已有的功能。
- 時間維度的整合透過 weekly view + daily note 生成實現，不建完整行事曆（月/日檢視屬 Obsidian Calendar plugin 範疇）。
- 多管道捕捉（PWA、LINE Bot、Claude Code MCP）→ Zettelkasten 成熟 → vault export 是核心資料流。

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
npm run prepare      # Initialize Husky after creating a worktree
# MCP server (in mcp-server/)
cd mcp-server && npm run dev:http  # MCP HTTP server on :3001 (Claude.ai connector)
cd mcp-server && npm run dev       # MCP stdio server (Claude Code, launched automatically)
```

See `/testing` for test architecture. See `/ops` for deployment.

## Data Model

Notes (items_active): `fleeting` → `developing` → `permanent` → `archived`. Exported notes move to items_vault (metadata + 500-char snippet; vault .md is content authority). Todos: `active` → `done` → `archived`. Scratch: `draft` → `archived`.

Full field reference in `conventions-detail` skill (invoke `/conventions-detail`). Two-table rationale + cross-table FK behaviour in `server/db/README.md`; v23 upgrade playbook in `docs/migration-v23.md`; v24 reverse-lookup migration in `docs/migration-v24.md`.

**Vault path resolution (post-v25):** vault_files reverse-lookup is the sole source of truth — `items_vault.export_path` was dropped in migration v25. Live path comes from `vault_files.sparkle_id = items_vault.id` LEFT JOIN at the listing layer and `getVaultPathBySparkleIdSync(sqlite, id)` at single-row sites. UI consumes `useVaultPathBySparkleId(id)`; AI agents inspect `vault_path_source: "lookup" | null` in VAULT_READONLY payloads (null = file not yet indexed or already released — retry the endpoint after the next 5-min scanner cycle).

Type conversion auto-maps status server-side. `category_id` preserved; `due`/`linked_note_id` cleared on todo→note; tags/priority/aliases cleared on →scratch.

`paused` flag: cross-type pause mechanism (boolean, orthogonal to status) — lives on items_active only. Paused items excluded from stale/attention/overdue/focus/unreviewed queries; visible in search and dedicated `/paused` page. Auto-cleared on archive/export/done.

Mutations on items_vault from MCP (`sparkle_update_note`, `sparkle_advance_note`, `sparkle_pause_note`, `sparkle_resume_note`) and REST (`PATCH /api/items/:id` on vault rows) return `VAULT_READONLY` (409). Use `sparkle_write_obsidian` for content edits or `sparkle_release_note` / `DELETE /api/items/:id/vault-stub` to drop Sparkle's record while preserving the vault `.md`.

DB migration version 0→27, idempotent. Migration safety is enforced by the local Codex PostToolUse hook (which calls `scripts/hooks/migration-safety.sh`), conditional pre-commit migration tests, and CI. Schema changes and `setSchemaVersion` belong in the same transaction when atomic rollback is required. v24 halts on orphans / unparseable frontmatter; v25 and v27 halt on backup / disk failures. Halts use `process.exit(78)` with systemd `RestartPreventExitStatus=78` — apply via `scripts/migrate-systemd-unit.sh`. v25/v27 backups land in `~/sparkle-backups/` via `VACUUM INTO` (rollback playbooks: `docs/migration-v25.md`, `docs/migration-v27.md`).

- Boolean settings: use `getBoolSetting(all, key, defaultValue)` — never raw `=== "true"`. New boolean settings MUST have a migration INSERT OR IGNORE + fresh install seed.

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

- 新 dashboard query：**必須比對既有 query 的 WHERE 條件**（`is_private = 0`、`paused = 0`、status 過濾、type 過濾），確保一致。
- 新 route：必須有獨立的 route validation 測試（不依賴純 function unit test 覆蓋）。
- 新 route：第一個產生 DOM 的元素必須有 `flex-1 min-w-0`（或用 Fragment 讓子元素直接參與父層 flex）。E2E layout test 會驗證。

Detailed module conventions (API retry, PWA, Logging, Sentry, CSP, Offline UI, State management, CI/CD, Sharing, Export, Data Model fields) — see `conventions-detail` skill.

## Feature Workflow

新功能開發流程（**先建 branch，再 review**）：

1. `git checkout -b feat/xxx`（或 worktree）
2. 設計：`/office-hours` → design doc
3. Review：`/autoplan` 或個別 review skills（在 feature branch 上跑，review log 才會對齊）
4. 實作 + 測試
5. `/ship` 出 PR → `gh pr merge --squash --auto`
6. PR merge 後切回 main `git pull`，跑 `bash scripts/release.sh` 發 GitHub Release（不是 release-please — 這裡用 4 段式 `major.minor.patch.hotfix`，script 讀 `VERSION` + `CHANGELOG.md` 對應 section、建 tag、發 release）。`--yes` 跳過確認、`--dry-run` 只預覽、`--version=X --sha=<commit>` 補發歷史。

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

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:

- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress → invoke context-save; resume → invoke context-restore
- Code quality, health check → invoke health

## Maintenance

Update docs in same commit: **CLAUDE.md** (core conventions). Skills (`.claude/skills/`) are local-only (gitignored).
