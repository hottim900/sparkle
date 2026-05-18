# Changelog

## [1.5.10.0] - 2026-05-18

### Added

- **DES-5 rename references dialog (`src/components/rename-references-dialog.tsx`).** When a title rename PATCH returns `swept_references.rewritten_count > 0`, the item-detail page now opens a dialog showing what just changed. Two visual modes per spec:
  - **Inline** (N ≤ 20): every rewritten source title listed as a `/item/:id` link.
  - **Summary** (N > 20): first 5 sources + "still X more" pointer to the admin recent-renames page.
  - Spec scope copy: "X 個 Sparkle 引用已更新。Vault daily-notes 不會變動 — Obsidian 的 rename 功能才是處理 vault 的方式".
  - Two-step **undo** (還原此 rename → 確認還原) wired to `POST /api/wikilinks/admin/undo-rename/:id`. On success: broad cache invalidation matching the admin recent-renames page (items/private/search/recent/stats/tags/resolver) so the UI returns to the pre-rename state immediately.
  - **Skipped-share-token warning** rendered when present — explains why the engine deliberately didn't rewrite shared-source rows (ENG-3 leak guard).

### Changed

- **`swept_references` payload extended with `rewritten_sources`** (id + title pairs). The rename engine already had source titles in its rewrite plan; previously the route layer only surfaced ids. The dialog reads titles inline so it doesn't have to issue N follow-up `GET /api/items/:id` requests.
- **`useItemForm` hook exposes `lastRename` + `clearLastRename`.** Captures `{ oldTitle, newTitle, swept }` after a successful title save when the server actually swept references; `item-detail` consumes this to open the dialog. Non-title field saves and rename no-ops leave it `null`.
- **`updateItem` API client return type widened to `UpdatedItem`** (was `Item`), with `swept_references?: SweptReferences`. Existing call sites that destructure standard `Item` fields are unaffected.

### Tests

- **9 new component tests** for `RenameReferencesDialog` covering inline mode, summary mode at N=30, skipped-share-token warning, two-step undo confirm flow (calls `undoRename`), undo cancel returns to initial state, hides undo when `history_id` null, renders `(未命名)` placeholder for empty source titles.
- **1 new server test** for the `rewritten_sources` payload contract (`items-title-collision.test.ts`): two sources with distinct titles produce a payload that maps id → title correctly.

### Notes

Closes the DES-5 gap the multi-agent re-audit caught on PR #345: the spec mandates a rename references dialog with inline/summary modes and Sparkle/Obsidian scope copy, but PR 9 shipped the backend `swept_references` payload without any frontend consumer — users renaming a title in the web UI got zero feedback. The dialog is the missing receiver.

No backend API surface added. The only schema-level change is one field added to an already-optional response object (`swept_references.rewritten_sources`), backward-compatible.

Full suite: **1847 passing** (up from 1837, +10 net new — 9 dialog tests + 1 server payload test). Lint + tsc clean.

## [1.5.9.0] - 2026-05-18

### Fixed

- **Title-collisions admin endpoint now matches the writer's normalizer.** `GET /api/wikilinks/admin/title-collisions` was grouping rows via SQL `LOWER(TRIM(title))`, but the writer's uniqueness check at `isTitleAvailable` runs `normalizeTitleForUniqueness` (trim → NFC → lowercase). NFC-divergent rows (e.g. NFC-composed "café" vs NFD-decomposed "café") would slip past the SQL grouping while still being blocked at write time — exactly the legacy duplicates this admin page exists to surface. Grouping now runs in JS via the shared normalizer.
- **Drain-now endpoint hardened.** Cap reduced from 500 rows/call to 50 (bounds writer-pin time per request); cap is exported as `max_per_call` in the success response so loop callers self-pace. Request-rate abuse stays in scope of Hono's existing global rate limiter — an earlier 200 ms in-process cooldown attempt cross-contaminated serial E2E tests for negligible marginal protection, so the per-request cap is the sole guard.
- **Undo mutation now invalidates downstream caches.** `src/routes/admin/recent-renames.tsx` previously only invalidated `["admin", "recent-renames"]`, but `undoRename` flips the target's title and rewrites every source — leaving `items` lists, individual `item` details, search, dashboard buckets, tag counts, and the wikilink resolver stale. Now invalidates all of them via `queryKeys` so the operator UI matches the new on-disk state immediately.

### Added

- **DX-2 expected-state-hash race guard for title renames.** `previewTitleRename` returns a `stateHash` fingerprinting target id + old title + each source's content sha256 (sorted by source id for determinism). Agents pass it back as `expected_state_hash` in `PATCH /api/items/:id` (title change). Inside the existing `BEGIN IMMEDIATE`, `applyTitleRename` recomputes the hash; mismatch → throws `RenameStateChangedError` → route returns 409 `RENAME_STATE_CHANGED` with both hashes for debugging. Closes the preview-to-commit race that the stateless preview alone couldn't catch.
- **DX-3 `Cite as` line in MCP item responses.** `formatItem` now emits `**Cite as**: \`[[<title>]]\``so an LLM reading`sparkle_get_note`knows the exact wikilink form to paste when citing the note. Suppressed for empty titles (uncitable) and the`未命名`placeholder (resolves to`null`per spec, so a`[[未命名]]` citation would dead-link).

### Tests

- **DX-2 state-hash round-trip + mismatch tests** in `rename-engine.test.ts`: preview returns a 64-char hex hash that `applyTitleRename` accepts; a stale hash throws `RenameStateChangedError`; hash changes when a source's content is edited or when a new source starts citing the target.
- **DX-2 PATCH-layer 409 contract** in `items-title-collision.test.ts`: PATCH with a stale `expected_state_hash` returns 409 `RENAME_STATE_CHANGED` with both hashes, and no rewrite happens.
- **NFC-divergent collision detection** in `wikilinks.test.ts`: composed vs decomposed "café" rows now appear as a single collision group (byte-divergence asserted up front).
- **Drain-now success + serial-call safety** in `wikilinks.test.ts`: success path returns `max_per_call: 50`; three back-to-back calls all return 200 (no cooldown gate).
- **DX-3 cite_as rendering** in `format.test.ts` (MCP): titled note → `Cite as` line present with exact wikilink form; empty-title and `未命名` rows suppressed.

### Notes

Picks up the multi-agent audit's findings on PR #344 (v1.5.8.0):

- **Code-reviewer warnings (real bugs in shipped code, all fixed here):** title-collisions normalizer mismatch, drain-now DoS surface, undo cache invalidation breadth.
- **Test-honesty fix:** the ENG-7 microtask stress test was renamed + recommented to reflect what it actually verifies (post-condition: 10 sequential calls → 1 row). better-sqlite3 is synchronous so the test never exercised true `BEGIN IMMEDIATE` contention; the runbook for that lives in `docs/wikilink-spec.md`.
- **Weak-defer re-audit:** DX-3 cite_as shipped (one field, low risk), DX-2 confirm-token shipped as `expected_state_hash` (stateless variant — server recomputes + compares, no in-process token store). ENG-22 promotion sweep stays a no-op by design (the wikilink parser rejects `[[]]`, so empty→non-empty has no source references to sweep — the existing comment at `server/lib/items.ts:646` is correct).

Full suite: **1837 passing** (up from 1827 last release, +10 net new tests across rename-engine / wikilinks / items-title-collision). MCP suite: **252 passing** (up from 249, +3 cite_as cases). Lint + tsc clean across both root and `mcp-server/`.

## [1.5.8.0] - 2026-05-18

### Added

- **ENG-8 perf gate.** `server/lib/__tests__/rename-engine-perf.test.ts` measures `applyTitleRename` over 50 sources × 11 trials; asserts P50 and P99 both stay under 500ms. The gate runs in the standard `npx vitest run` so regressions block CI. 500ms is the "user notices and gets nervous" threshold from the design doc (line 204-205); typical sync rename should be well under 50ms.
- **E2E rename flow.** `e2e/wikilink-rename.spec.ts` covers three scenarios: title change rewrites the source's content + `swept_references` lands in the PATCH response (DX-5 contract), `preview-rename` returns counts without modifying source content, and `POST /api/items` rejects duplicate titles with 409 `TITLE_COLLISION`. Each test uses a UUID-suffixed title to avoid cross-test collisions in the shared E2E DB.
- **Admin frontend UIs.** Two new TanStack Router file routes:
  - `/admin/recent-renames` (`src/routes/admin/recent-renames.tsx`) — table of recent `rename_history` rows with one-click undo (confirms via native `window.confirm` before calling `POST /admin/undo-rename/:id`). Undo rows are visually distinguished by an `undo` marker in the executor column.
  - `/admin/title-collisions` (`src/routes/admin/title-collisions.tsx`) — groups of items_active rows that share a normalized title. Each row clicks through to `/item/:id` so the operator can rename or merge.
- **Three new API client functions** in `src/lib/api.ts`: `listRecentRenames`, `undoRename`, `listTitleCollisions`. Type definitions exported for downstream use.

### Tests

- **ENG-7 microtask-parallel stress test** (`wikilink-write-hooks.test.ts`): schedules 10 concurrent `createItem` calls with the same title via `Promise.allSettled`; asserts exactly 1 fulfilled + 9 rejected with `TitleCollisionError` + only 1 row in DB. Proves the `BEGIN IMMEDIATE` gate works under microtask contention (was previously only tested serially).
- **`swept_references` API contract tests** (`items-title-collision.test.ts`): title-change PATCH → response has the field with correct counts; non-title PATCH → field absent; first-time title set on empty row → field absent (not a rename).
- **`preview-rename` NFC self-rename test** (`wikilinks.test.ts`): target stored as NFC composed, preview with NFD decomposed form → `would_rewrite_count = 0`. Uses explicit Unicode escapes so any normalize-on-save editor/git filter can't collapse the literals to identical bytes.
- **`rename-engine-integration.test.ts` NFC test hardening** — added explicit `expect(composed).not.toBe(decomposed)` sanity assertion + escape-preservation comment so the test fails loud if a future formatter collapses the strings (the multi-agent audit caught this exact risk).
- **`rename-history-cleanup.test.ts` day-boundary flake fix** — switched the no-op test from `new Date().toISOString()` (which could flip rows in/out of the 30d window at midnight) to explicit fixed dates passed via the `now` parameter.
- **`wikilink-text.test.tsx` matchMedia cleanup** — added `beforeEach`/`afterEach` that capture and restore `window.matchMedia` so the mock installed for mobile/desktop branching tests doesn't leak into later test files when the worker is shared.

### Notes

Picks up the 3 "weak defer" items the multi-agent audit (post-#343) flagged as having unconvincing rationale: ENG-8 perf gate, E2E rename flow, admin frontend UIs. Real deferrals stay deferred — DES-5 rename dialog (UX taste call), DX-3 cite_as (semantics unclear), DX-2 stateful confirm_token (stateless preview already shipped). Test gap fixes were direct findings from the same audit's coverage analysis.

Full suite: **1827 passing** (up from 1817). Lint + tsc clean.

## [1.5.7.0] - 2026-05-18

### Added

- **Mobile-friendly wikilink preview (DES-2).** Resolved `[[Title]]` references now ship a touch-device variant alongside the existing HoverCard. On hover-capable devices (desktop) the preview opens on pointer hover as before; on touch devices the link still navigates on tap (preserving the familiar mobile pattern: tap = go), and a small `ⓘ` button next to the link opens a tap-triggered Popover with the same preview content. Driven by a new `useIsHoverDevice()` hook that reads `(hover: hover)` via `matchMedia` and reacts to changes (external pointer plugged into a tablet, etc.).
- **`src/hooks/use-is-hover-device.ts`.** SSR-safe — returns `true` (desktop default) on first render, re-evaluates on mount. Exported for future components that need the same desktop/touch split.

### Tests

- 2 new `WikilinkChip` tests cover the mobile path (peek button present, link still has navigation `href`) and the desktop path (no peek button on hover-capable devices). The `matchMedia` mock toggles `matches: false`/`true` to drive the hook.

### Notes

Follow-up to v1.5.6.0 (PR 7 MCP additions). Closes the last frontend item from the wikilink-first rollout's deferred list. With this PR, all of the multi-agent-audit "no real reason to defer" items have shipped.

## [1.5.6.0] - 2026-05-18

### Added

- **MCP wikilink admin tools (DX coverage).** Three new MCP tools wrap the admin REST surface so operators can manage rename audit + collision reconciliation from the agent surface:
  - `sparkle_list_title_collisions` — `GET /api/wikilinks/admin/title-collisions`. Lists pre-Pre-PR0e duplicate titles grouped by normalized form; allowlist (`未命名`) and empty titles excluded; rows sorted `modified DESC`.
  - `sparkle_list_recent_renames(limit?)` — `GET /api/wikilinks/admin/recent-renames`. Recent rename_history entries, default 50, max 200.
  - `sparkle_undo_rename(history_id)` — `POST /api/wikilinks/admin/undo-rename/:id`. Replays inverse rewrite; the undo is itself audit-logged with `performed_by = "undo:<originalId>"`.
- **`sparkle_preview_rename(target_id, new_title)` — DX-2 dry-run.** Wraps a new `GET /api/wikilinks/admin/preview-rename` endpoint. Stateless: returns `would_rewrite_count`, `would_rewrite_source_ids`, `would_skip_share_token_source_ids`, and a 5-item `preview` sample without committing. Agents call this before `sparkle_update_note({ title })` so the user can review impact ("this will rewrite 7 other notes — proceed?"). Especially valuable for hub notes with many backlinks.
- **`swept_references` in PATCH response (DX-5).** `PATCH /api/items/:id` and `PATCH /api/private/items/:id` now include a `swept_references: { rewritten_count, rewritten_source_ids, skipped_share_token_source_ids, history_id }` field when the title change triggered the rename engine. `updateItem` exposes the `RenameResult` via a non-enumerable side-channel (`getRenameResultFromItem` helper) so existing destructure-by-known-fields callers are unaffected.
- **Structured error codes in MCP responses (DX-4 / DX-7).** `SparkleApiError` now carries `code: string | null` and the full parsed error payload. `formatToolError` emits structured JSON (`{ error, status, code, message, ...payload }`) whenever the server returned a code — agents branch on `code === "TITLE_COLLISION"` rather than regex-matching prose. Falls back to the original prose format when there's no code (server returned plain text or schema error).
- **`previewTitleRename(sqlite, target_id, old_title, new_title)` in `server/lib/rename-engine.ts`.** Read-only companion to `applyTitleRename` — same reference_index query, same ENG-3 share-token guard, but no UPDATEs. Returns `PreviewResult` with the predicted impact plus a snippet preview of up to 5 sources.

### Tests

Test coverage for these additions ships alongside the route + tool changes — `server/lib/__tests__/rename-engine-share-leak.test.ts` and `server/routes/__tests__/wikilinks.test.ts` already exercise the underlying engine + endpoint paths; this PR adds preview-rename to those suites. MCP tool wrappers are thin pass-throughs to the REST client (covered indirectly by the route tests).

### Notes

Follow-up to v1.5.5.0 (PR 6 rename engine extensions). Closes the deferred DX items the multi-agent audit flagged. `sparkle_update_note` cite_as field (DX-3) and confirm_token protocol (DX-2 stateful variant) are NOT shipped — preview is the stateless equivalent for dry-run, and cite_as semantics are still unresolved (the current `resolveWikilink` already returns canonical title).

## [1.5.5.0] - 2026-05-18

### Added

- **ENG-3 share-token leak guard in rename engine.** `applyTitleRename` now skips sources that have an active `share_tokens` row when the target item is private. Without the skip, renaming a private item would rewrite the source's `[[Old Title]]` content to `[[New Private Title]]` — and the public share viewer (who can see the source's rendered content) would see the new private title in plain text. Currently the resolver privacy filter (`is_private = 0` on `resolveWikilinkTitle`) prevents private targets from accumulating `reference_index` entries through the normal worker path, so this is defense-in-depth — but the safety net catches admin-debug INSERTs and any future change that makes private wikilinks resolvable for authenticated surfaces. `RenameResult.skippedShareTokenSourceIds` carries the IDs so the operator UI can surface the skipped count.
- **ENG-19 strip `[[…]]` from public share render.** `renderPublicPage` now runs content through `stripWikilinkMarkup(..., { skipCode: true })` before marked tokenization. `[[Foo]]` becomes plain text `Foo`; `[[Foo|alias]]` becomes `alias` (alias wins for display). Code-block contents are preserved verbatim — a user who wrote `[[example]]` inside a fenced block expected the literal text to render. This closes the visual leak path: even when a source contains a `[[Private Title]]` reference the user wrote manually (which the renderer would otherwise pass through as `[[Private Title]]` literal text in HTML), the public viewer sees only the title with no Sparkle markup.
- **`GET /api/wikilinks/admin/title-collisions`.** Returns groups of `items_active` rows that share a normalized title — pre-Pre-PR0e duplicates that slipped in before PR 5's write-time enforcement. Allowlist titles (`未命名`) and empty titles are excluded. Response shape: `{ collisions: [{ normalized, rows: [{ id, title, type, status, modified }] }], total }`. Rows within each group sorted by `modified DESC` so the operator sees the newest first. Guarded by the global `/api/*` Bearer auth middleware.
- **30-day `rename_history` retention.** `server/lib/rename-history-cleanup.ts` exposes `pruneRenameHistory` (deletes rows where `performed_at < now - 30d`) and `checkAndPruneRenameHistory` (a 60s-tick scheduler with a 24h internal throttle). Wired into `server/index.ts` next to the other periodic timers. Without this the audit table grows unbounded — operator-facing undo only matters for recent renames, anything older is git/backup territory.
- **`stripWikilinkMarkup` gained `{ skipCode?: boolean }`.** Default `false` preserves existing callers (LINE daily brief, share-page description) where stripping inside code is acceptable. `true` is used by the public-page renderer so code samples render the literal `[[…]]` text the user wrote.

### Tests

- 5 new ENG-3 tests in `server/lib/__tests__/rename-engine-share-leak.test.ts`: skip private+shared, rewrite non-shared private siblings, public-target case (no skip), unlisted-visibility coverage, all-private-no-shared case. Tests use manual `INSERT INTO reference_index` to exercise the engine's skip logic regardless of how the index got populated.
- 4 new cleanup tests in `server/lib/__tests__/rename-history-cleanup.test.ts`: prune older-than-30d, no-op when nothing stale, 24h throttle short-circuits subsequent ticks, throttle reset after `resetRenameHistoryCleanupForTest`.
- 6 new ENG-19 tests in `server/lib/__tests__/render-public-page-wikilinks.test.ts`: strip `[[Foo]]`, strip alias, preserve fenced code, preserve inline backticks, OG description also stripped, no-op when no refs.
- 5 new admin-collisions tests in `server/routes/__tests__/wikilinks.test.ts`: 401 unauth, empty list, case-insensitive grouping, 未命名 allowlist exclusion, empty-title exclusion, modified-desc ordering.
- 3 new `stripWikilinkMarkup` tests in `src/lib/__tests__/wikilink.test.ts` covering the new `skipCode` option.

### Notes

Follow-up to v1.5.4.0 (PR 5 rename engine + title uniqueness). Closes the defense-in-depth items the multi-agent audit flagged: ENG-3 leak guard, ENG-19 public-render strip, admin title-collisions surface for legacy duplicates, retention policy for the unbounded audit table.

## [1.5.4.0] - 2026-05-18

### Added

- **Title rename propagation engine + title uniqueness enforcement (PR 5).** Combines the rename engine (originally PR 3, replaces the PR #339 scope that conflicted with the v27 backfill ship-order) with the application-layer title uniqueness check that Pre-PR0e §114-129 specified but PR 1 left unwired.
  - `server/lib/rename-engine.ts` reads `reference_index` by `target_id`, computes rewrites via the shared parser (preserves alias, applies in descending offset order so earlier indices stay valid per ENG-20), and applies all source UPDATEs in a single transaction. `PATCH /api/items/:id` (and any other `updateItem` caller) auto-triggers the engine whenever `title` changes.
  - `createItem` / `updateItem` now call `isTitleAvailable()` before writing and throw `TitleCollisionError` on conflict. The check + insert/update are wrapped in `BEGIN IMMEDIATE` (ENG-7) so two concurrent writers can't both see "available" and both succeed.
  - `POST /api/items` and `PATCH /api/items/:id` catch `TitleCollisionError` → `409 { code: "TITLE_COLLISION", attemptedTitle, conflictingId? }`. MCP `sparkle_create_note` / `sparkle_update_note` surface the same code.
- **rename_history audit log + undo.** Every rename writes an append-only row capturing `target_id`, `old_title`, `new_title`, `source_count`, `performed_at`, `performed_by`. `GET /api/wikilinks/admin/recent-renames` lists the most recent N (default 50, max 200) for the operator UI. `POST /api/wikilinks/admin/undo-rename/:historyId` replays the inverse rewrite — flips the target title back to `old_title` AND sweeps every source still citing `new_title` to `old_title`. The undo is itself recorded with `performed_by = "undo:<originalId>"` so the audit log stays append-only.

### Behavior locked

- **Active-only scope (Pre-PR0d carve-out).** The engine touches `items_active.content` only. Vault `.md` files (including daily-notes that link with `[[Title|sparkle-<shortId>]]` alias syntax) are never rewritten — vault is SSOT post-v25. Obsidian's own rename feature handles vault-side cleanup for users who rename a permanent note.
- **First-time title set is not a rename.** When a row goes from `title = ""` → `title = "Something"`, no rename engine runs.
- **NFC normalization at write closes the round-trip gap.** Setting `title = "Café"` (decomposed) when the existing title is `"Café"` (composed) is a no-op rename because both normalize identically.
- **Legacy `筆記（xxxx）` references are NOT swept by title rename.** They target by short id; a title change leaves their resolution unaffected.
- **Title uniqueness scope: items_active only.** Vault titles aren't checked; the resolver tolerates vault collisions by returning null. The `未命名` allowlist always passes (multiple fleeting captures with the default placeholder are legitimate).
- **CASCADE deletion stays correct.** Deleting a target row leaves rename_history rows pointing at the deleted id (audit log is durable). Source-side reference_index rows still CASCADE-delete when the source itself is deleted.

### Tests

- **Rename engine**: 16 unit tests in `server/lib/__tests__/rename-engine.test.ts` (`rewriteWikilinks`, `applyTitleRename`, `undoRename`), 5 integration tests in `server/lib/__tests__/rename-engine-integration.test.ts` (the `updateItem` auto-trigger including NFC-equivalence no-op + first-title-set no-op), 7 router tests in `server/routes/__tests__/wikilinks.test.ts` (`/admin/recent-renames` + `/admin/undo-rename/:historyId` covering auth, 404, round-trip).
- **Title uniqueness**: integration tests in `server/lib/__tests__/wikilink-write-hooks.test.ts` cover `createItem` collision, `updateItem` collision, `exceptId` self-rename, `未命名` allowlist bypass, NFC duplicate detection, BEGIN IMMEDIATE concurrent-writer race (two `db.transaction` calls in parallel — only one wins).
- **Route layer**: `server/routes/__tests__/items.test.ts` extended with `POST /api/items` 409 and `PATCH /api/items/:id` 409 cases.
- Drizzle `DB` type widened to `BetterSQLite3Database<typeof schema> & { $client: Database.Database }` so the rename engine can reach the raw sqlite handle without inline casts. Mirrored in `server/lib/line-commands/types.ts`.

### Why this PR exists

PR #339 (the original rename engine PR) sat with merge conflicts after PR #340 (migration v27 backfill) shipped ahead of it. Rather than rebase #339 mechanically, this PR rebuilds the scope cleanly and adds the title uniqueness wiring that Pre-PR0e §114-129 specified but PR 1 left as unused exports. Together they close the correctness gap where users could create duplicate titles and the rename engine would have nothing to do.

## [1.5.3.0] - 2026-05-18

### Added

- **Migration v27: legacy `筆記（xxxxxxxx）` → `[[Title]]` backfill (PR 4).** One-shot data migration that rewrites every legacy short-ID reference in `items_active.content` to the canonical wikilink syntax shipped in v1.5.1.0. After v27, Sparkle's writing surface is uniform — all cross-references render through the same Obsidian-native parser, the rename engine (PR 3) propagates title changes through them, and the legacy `筆記（` syntax is retired from active content.
- **Conservative scope.** v27 only rewrites the `筆記（xxxxxxxx）` pattern (4-8 lowercase hex chars). Code-block skipping (` ``` `, `~~~`, inline backticks) mirrors the live parser so the migration matches running renderer behavior (ENG-26). Bare hex IDs are intentionally NOT rewritten — false-positive risk against commit hashes, build IDs, and other technical content was unacceptable. References to deleted or private items stay verbatim so search can find them.
- **`backfill_v27_ambiguous` queue.** When a short-id prefix matches ≥2 items (cross-table, active-priority), the reference is left verbatim and recorded in this table with `(short_id, source_id, recorded_at)`. Operators query the table to surface manual-reconciliation work; a follow-up frontend PR ships the admin UI alongside `/admin/title-collisions`.
- **`docs/migration-v27.md`** with rollback runbook, halt-category triage, ambiguous-queue workflow, and the rationale for the bare-hex carve-out.

### Backup safeguards

v27 follows the v25-pattern backup rules — added because this migration mutates content non-trivially and a parser bug could silently corrupt data without a verified pre-migration snapshot:

- **Unique per-run backup path**: `~/sparkle-backups/todo.db.bak-pre-v27-<ms>-<pid>-<uuid8>` guards against millisecond-collision (systemd tight-restart loop) and parallel migration attempts.
- **Pre-flight disk check**: requires 1.2× DB size free; throws `migration_v27_halted_no_disk` otherwise with bilingual operator-facing message.
- **Post-backup verify**: opens backup as readonly, asserts `PRAGMA integrity_check = "ok"` AND `schema_version = 26`; throws `migration_v27_halted_backup_failed` otherwise.
- **No-op skip**: when no `items_active.content` matches `LIKE '%筆記（%'`, skip the backup entirely and just stamp `schema_version = 27`. Fresh installs and vault-only deployments pay zero backup cost.
- **systemd integration**: V27HaltError routes through `haltAndExit` → `process.exit(78)`. Pairs with `RestartPreventExitStatus=78` in `scripts/systemd/sparkle.service` so the operator sees a stable error window instead of a restart loop.

### Behavior locked

- **Paused items still rewrite (ENG-27).** Paused is orthogonal to content format; the rewrite is bookkeeping, not user-visible churn.
- **Descending offset order (ENG-20).** Replacements applied right-to-left so earlier match positions stay valid as the string grows/shrinks.
- **Sources marked `reindex_dirty=1`** after the rewrite so the worker re-derives `reference_index` rows on the next cycle.
- **Title sanitization** matches `server/lib/export.ts:108` — `|` → `-`, `]]` → `）`, `[[` → `（`, `\n` → ` ` — so the backfill output mirrors what `resolveSparkleReferences` already produces on export.
- **Vault is NOT touched.** Pre-PR0d carve-out: `items_vault` and vault `.md` files are out of scope. Vault is SSOT post-v25; Obsidian-side cleanup is the user's choice.

### Tests

- **12 new tests** in `server/db/__tests__/migration-v27.test.ts`: 8 unit tests for `backfillLegacyHexInContent` (single rewrite, multiple in descending order, fenced/inline code-block skip, ambiguous queue, sanitization, deleted target verbatim), 4 integration tests for `migrateV26toV27` (no-op when no legacy, full backfill round-trip, ambiguous recording, pre-migration backup creation).

### Migration sequencing

PR 4 is the final piece of the 4-PR wikilink-first rollout. **Ship order constraint** (from CLAUDE.md memory): DB migration PRs ship independently — wait for deploy + health check on PR 1 (v26) before PR 4 (v27) lands.

## [1.5.1.1] - 2026-05-18

### Added

- **MCP wikilink contract — resolver + admin wrapper tools (PR 2).** Two new MCP tools expose the v1.5.1.0 wikilink REST surface to agents:
  - `sparkle_resolve_wikilink(title)` — wraps `GET /api/wikilinks/resolve`. Returns `{ resolved: true, id, title, origin, snippet }` on match, `{ resolved: false, title }` on miss/collision. Agents call this before writing `[[Title]]` into content to verify the target is unique-and-present (avoiding writing references that would render as purple-unresolved). Locked resolution rules surfaced in the tool description so agents can't be talked into wrong assumptions: NFC + ASCII case-insensitive, active-priority over vault, collision returns null, `未命名` allowlisted.
  - `sparkle_rebuild_reference_index` — wraps `POST /api/wikilinks/admin/rebuild`. Disaster-recovery only; routine writes already keep the index live. Returns `{ status: "queued", queued: <count> }`.
- **`SPARKLE_INSTRUCTIONS` updated with `[[Title]]` guidance section.** The MCP system prompt now tells agents: prefer `[[Title]]` over legacy `筆記（xxxxxxxx）` for new content; alias syntax is `[[Real|Display]]`; parser is conservative (rejects multi-line, oversized, nested); code-block fences (` ``` `) and inline backticks skip parsing so `[[refs]]` in code samples never become live; active-priority resolution; `未命名` collision allowlist; verify with `sparkle_resolve_wikilink` before writing; don't manually rewrite legacy refs (wait for PR 4 backfill v27).

### Notes

- PR 2 of 4 in the wikilink-first cross-references rollout. **Deferred to PR 3** (rename engine): `swept_references` in `sparkle_advance_note` response, `confirm_token` dry-run protocol, `sparkle_list_title_collisions` admin tool — these are properly defined alongside the rename behavior that fills them in. **Deferred to PR 4**: `docs/migration-v27.md`. Defining schemas before the implementation lands risks shipping shapes that don't match what PR 3 actually needs to send.

## [1.5.1.0] - 2026-05-18

### Added

- **Wikilink-first cross-references — resolver + renderer foundation (PR 1).** Sparkle now resolves `[[Title]]` (and `[[Title|alias]]`) inline anywhere notes render via Markdown. The renderer is Obsidian-native: resolved links navigate to `/item/:id` with a HoverCard preview showing origin (Sparkle / Vault) and a 200-codepoint snippet; unresolved links render purple per Obsidian convention; mixed-state legacy `筆記（xxxxxxxx）` references render as a dashed-border chip so users see they're deprecated. Parser is conservative — rejects multi-line, empty, oversized (>256 chars per ENG-18), and nested `[[`. Code-block aware via the `remark-wikilink` plugin built on `mdast-util-find-and-replace`, so wikilinks inside fenced/inline code never become live references (ENG-26). Shared parser at `src/lib/wikilink.ts` is imported by both the frontend renderer and the server-side reindex worker (server tsconfig widened to include `src/lib/wikilink.ts` so the parser is the single source of truth).
- **DB migration v26: `reference_index` + `rename_history` + `items_active.reindex_dirty`.** Additive migration adds the reverse-lookup table (`reference_index(source_id, target_id, char_offset, raw_title, kind)`) the rename engine (PR 3) needs, plus the rename audit log (`rename_history`, placeholder so PR 3 doesn't ship a separate migration just for one table), plus the `reindex_dirty` flag the background worker drains. All existing `items_active` rows are marked dirty at upgrade so the worker bootstraps the index over its first few 60s cycles (ceil(rows/50) minutes to drain). Fresh installs include the same shape from `initializeDatabase`. Idempotent on re-run (PRAGMA / IF NOT EXISTS).
- **Background reindex worker.** `server/lib/wikilink-worker.ts` drains `reindex_dirty=1` rows in 50-row batches every 60s. Per-source transaction so a single malformed row doesn't block the queue. Skipped-tick counter resets on successful entry so transient backlog doesn't poison warning cadence for process lifetime.
- **Write hooks.** `createItem`, `updateItem` (only when `title` or `content` changes), and the bulk import handler (`server/index.ts`) now set `reindex_dirty = 1` at the same UPDATE. Bulk status mutations (develop/mature/done/active/archive) do NOT mark dirty — status doesn't affect resolver output, so they'd be no-ops.
- **REST API: `GET /api/wikilinks/resolve?title=X`.** Returns `{ id, title, origin, snippet }` (200) or `{ error: "NOT_FOUND" }` (404) for miss / collision. Snippet truncation pushed into SQLite (`SUBSTR(content, 1, 800)`) so multi-MB content isn't shipped to userland just to slice 200 chars. Frontend `WikilinkChip` calls this via React Query with a 5-minute staleTime per unique title. Resolver memoizes per unique normalized title inside `reindexItemReferences` — a hub note linking to the same title 50 times pays one DB round-trip per unique target.
- **Admin disaster-recovery: `POST /api/wikilinks/admin/rebuild`.** `TRUNCATE reference_index` + mark every active row dirty. Returns 202 with queued count. Guarded by the global `/api/*` auth middleware. Use when the index drifts (manual SQL edits outside the chokepoint, parser bug fix that needs to re-derive).
- **Application-layer title uniqueness primitive.** `isTitleAvailable(sqlite, normalizedTitle, exceptId?)` and `TitleCollisionError` ship in `server/lib/wikilink.ts` per Pre-PR0e spec (active-only scope, `未命名` allowlisted, NFC + ASCII case-insensitive normalization). PR 3 wires these into the rename UI; PR 1 doesn't enforce yet — the resolver tolerates the 2 existing prod duplicates by returning `null` (renderer falls back to unresolved/purple).
- **NFC write normalization.** `createItem`/`updateItem` apply `.normalize("NFC")` to titles so a decomposed `Café` (U+0065 U+0301) written via one capture surface resolves via composed `[[Café]]` written via another. Without this, the resolver's `LOWER(TRIM(title))` SQL compare never lands on canonical form.

### Changed

- **`tsconfig.server.json` rootDir widened to `.`** and includes `src/lib/wikilink.ts` so the server can import the shared parser without duplicating it. Compile output is `noEmit` so no on-disk layout breaks.

### Tests

- **78 new tests** across 6 files: shared parser unit (`src/lib/__tests__/wikilink.test.ts`), server resolver + reindex + worker (`server/lib/__tests__/wikilink.test.ts`), write-hook integration (`server/lib/__tests__/wikilink-write-hooks.test.ts`), v26 migration (`server/db/__tests__/migration-v26.test.ts`), wikilinks router (`server/routes/__tests__/wikilinks.test.ts`), frontend renderer (`src/components/__tests__/wikilink-text.test.tsx`). Coverage: collision returns null, active priority over vault, allowlist (`未命名`), NFC round-trip via `createItem`, write-hook scope (title/content yes, status/priority no), CASCADE on source delete, batch limit, idempotent migration, fresh-install starts at 26, admin auth + truncate-and-prime semantics, resolved/unresolved/alias renderer states.

## [1.5.0.3] - 2026-05-18

### Added

- **`PATCH /api/items/:id` optional `revision` compare-and-swap guard.** Callers may include `revision: <64-char hex sha256 of current content>` in the PATCH body; the server rejects with `412 PRECONDITION_FAILED` if the stored content has drifted, returning `code: "REVISION_MISMATCH"` plus the actual `current_revision` and `current_content` so the client (or rename engine) can three-way-merge without a second round-trip. Backwards compatible — PATCH without `revision` keeps last-write-wins semantics. The CAS read happens immediately before the UPDATE inside the same connection so better-sqlite3's per-connection write serialization closes the same-process TOCTOU window; cross-process WAL writers (MCP stdio) still need a `BEGIN IMMEDIATE` wrap deferred to PR3. New module `server/lib/revision.ts` mirrors the wire format of `mcp-server/src/edit/revision.ts` so future MCP wrappers can share tokens with the REST PATCH path. Pre-PR0b prerequisite for the wikilink-first rename engine (PR3), which rewrites cited items' content and needs to detect concurrent edits instead of silently clobbering them.

## [1.5.0.2] - 2026-05-18

### Changed

- **FTS `items_active_au` trigger narrowed to `AFTER UPDATE OF title, content`.** The pre-v26 unqualified `AFTER UPDATE` trigger fired on every column change — flipping `viewed_at`, `paused`, `status`, or the upcoming `reindex_dirty` flag would all reindex FTS for no reason. The trigger now fires only when title or content actually changes. `setupFTS` performs a one-time drop-and-recreate inside a transaction on databases that still carry the legacy unqualified form; the migration v23 trigger (line 980) is narrowed inline so fresh installs skip the rewrite path. Bisectable prerequisite for the wikilink-first cross-references feature — its upcoming `reindex_dirty` write trigger would otherwise loop-fire FTS reindex on every flip.

## [1.5.0.1] - 2026-05-13

### Fixed

- **`sparkle_edit_note` mid-content newline merge.** `insert_after_line` and `replace_lines` silently byte-merged the last line of `content` with the following line when the splice point wasn't at EOF and `content` didn't end with `\n` (e.g. `insert_after_line(1, "L1\nL2")` on `"a\nb\nc"` produced `"a\nL1\nL2b\nc"` instead of `"a\nL1\nL2\nb\nc"`). `applyResolved` now extends the existing EOF newline rule symmetrically: for each distinct mid-content splice range `(start, end)` where `end < content.length`, the LAST source-order eligible op gets `\n` appended. Stacked inserts at the same offset preserve caller-intended concatenation; mixed-kind ops at the same start with different right-edges each get their own auto-terminate via full-range keying. `replace_block` / `delete_block` / `delete_lines` / `replace_text` are excluded — `replace_text` retains its byte-exact contract. `CONTENT_TOO_LARGE` border can shift by ≤ 1 byte per distinct mid-content range; the hint now mentions the auto-append byte budget so chained LLM trimming reconciles. **CRLF caveat:** notes authored with `\r\n` line endings receive a bare `\n` auto-append on mid-content splices, producing mixed line endings — first-class CRLF support is deferred.

### Upgrade Note

**Action required:** Claude.ai connector users must disconnect and reconnect after this release to refresh the tool schema describes. Claude Code stdio sessions pick up the rebuilt `dist/` automatically on next launch. Stale connectors will operate on the old `instructions.ts` (no auto-append guidance) while the new `ops.ts` rule is active — producing silently extra-terminated content with no detection signal.

## [1.5.0.0] - 2026-05-08

### MCP edit primitive v2 — `sparkle_edit_note`

LLM-driven content editing on long Chinese passages used to fail unpredictably: `sparkle_update_note(old_content, content)` did byte-exact find-and-replace, but autoregressive token sampling routinely substituted half-width ASCII (`: ; ( ) ,`) for the full-width punctuation (`：；（），`) the LLM had just read seconds earlier. Each `NO_MATCH` cost a round-trip and pushed agents toward riskier full-content replaces.

v2 redesigns the edit primitive around how LLMs actually behave: address blocks/lines symbolically, fall back to a deterministic punctuation fold for surgical text changes, and apply multi-op batches atomically against a snapshot pinned by `revision`.

### Added

- **`sparkle_edit_note(id, revision, ops[])`** — new MCP tool, six op kinds applied atomically:
  - `replace_block(handle, content)` — swap a paragraph/heading/list/table/code block by opaque handle
  - `replace_lines(start_line, end_line, content)` — rewrite an inclusive line range
  - `replace_text(old, new)` — Tier 1 byte-exact; Tier 2 retries with a curated CJK ↔ ASCII punctuation fold (`： → :`, `； → ;`, `（ → (`, `） → )`, `， → ,`, `。 → .`, `！ → !`, `？ → ?`, `、 → ,`) and excludes fenced + inline code regions from candidates
  - `delete_block(handle)` / `delete_lines(start_line, end_line)`
  - `insert_after_line(line, content)` — `line=0` prepends
- **`sparkle_get_note` / `sparkle_create_note` responses** now carry an `edit-context` fenced block containing `revision` (sha256 hex), `lines` (1-indexed line array), and `blocks` (handle + line range + type + 80-char preview for every top-level markdown block). For vault-origin items all three are `null` (vault `.md` is the source of truth — use `sparkle_write_obsidian`). The `sparkle_edit_note` success response carries the same payload plus per-op `match_tiers`, so chained edits never need a re-fetch.
- **`mcp-server/src/edit/`** — six new modules (`revision.ts`, `normalize.ts`, `block-parser.ts`, `fuzzy.ts`, `errors.ts`, `ops.ts`) plus `mcp-server/src/lib/vault-readonly.ts` shared helper. 80 unit tests in `__tests__/edit/` (225 total mcp-server tests) cover surrogate pairs, CJK-punct invariant, code-block exclusion, multi-op atomicity, EOF newline rule, empty-content bootstrap, GFM tables, mocked-throw `PARSE_ERROR`, and `REVISION_MISMATCH` recovery.
- **Structured `EditFailure` payloads** — `VAULT_READONLY` (canonical shape via shared helper), `REVISION_MISMATCH` (returns fresh `revision` + `lines` + `blocks`), `NO_MATCH` (closest_match + char-level diff), `AMBIGUOUS_MATCH` (line locations + match_tier), `INVALID_HANDLE` (lists valid_handles), `INVALID_RANGE`, `EMPTY_OPS` / `TOO_MANY_OPS` / `OVERLAPPING_OPS` / `DUPLICATE_OPS`, `CONTENT_TOO_LARGE` (delta_per_op), `PARSE_ERROR` — every variant carries the recovery context the LLM needs without an extra round-trip.

### Changed

- **`sparkle_update_note` is metadata-only.** The `content` and `old_content` parameters were removed (zod `.strict()` rejects them). All content edits route through `sparkle_edit_note`. Metadata fields (title, tags, status, type, priority, due, aliases, source, linked_note_id, category_id, is_private, paused, paused_context) are unchanged.
- **`mcp-server/src/docs/instructions.ts`** — content editing section rewritten with the magical-moment headline, op-choice safety ranking (`replace_block` > `replace_lines` > `replace_text`), decision table, six worked examples (one per op kind), and three error-recovery worked examples (REVISION_MISMATCH, AMBIGUOUS_MATCH, NO_MATCH).
- **MCP server version bumped to 2.0.0** (`mcp-server/package.json`). Three new direct dependencies: `mdast-util-from-markdown` (markdown AST parser; chosen over `remark-parse` to avoid a unified-runtime dep), plus `mdast-util-gfm-table` + `micromark-extension-gfm-table` so `| a | b |` table syntax actually emits `type: "table"` blocks rather than getting silently classified as paragraphs.

### Migration notes

- **Single user, clean cutover.** Sparkle's only MCP consumers are the user's own Claude.ai connector and Claude Code. After deploying:
  1. Build the dist (`cd mcp-server && npm run build`) — already part of the standard release pipeline.
  2. Restart Claude Code sessions to pick up the stdio MCP changes.
  3. The Claude.ai connector re-handshakes automatically; no need to delete/recreate.
- **In-flight `sparkle_update_note(content, …)` calls** return zod "Unrecognized key" errors. The tool description now points to `sparkle_edit_note`; LLMs reading the description self-correct.
- **No DB migration**, no schema change. This is an MCP-layer-only change.

### TOCTOU note (acknowledged)

There is a small window between `applyEdits`'s revision check and the REST `PATCH /api/items/:id` persist call where a concurrent web UI write could land and be silently overwritten. Single-developer single-machine usage means this is rare; closing it properly requires server-side `If-Match` semantics (deferred). If real-world race incidents appear it becomes a follow-up issue.

### Markdown parser DoS surface (known limitation)

`mdast-util-from-markdown` exhibits quadratic backtracking on pathological alternating-emphasis input (e.g. `*_*_*_…` × 25k chars hangs the event loop ~12s). Single-user PKM threat model: the only realistic source is the user themselves, who would feel the slowness and stop. A worker-thread sandbox + timeout would close the gap; deferred since multi-tenant exposure does not exist for self-hosted Sparkle.

## [1.4.5.0] - 2026-04-30

### Removed

- **`items_vault.export_path` column dropped** (migration v25). `vault_files.sparkle_id` reverse-lookup is now the sole source of truth for an exported note's vault path. v24's dual-write window confirmed the lookup hits in every observed case; the snapshot column is gone and so is the watcher that used to self-heal it.
- **`server/lib/vault-watcher.ts`** (140 LOC) and its test — the 60s self-heal scan loop has nothing left to heal once `export_path` is gone. Reverse-lookup is the primary path everywhere.
- **`server/lib/vault-backfill.ts`** (100 LOC) and its test — v24 ran the one-shot backfill; the recurring loop has no purpose post-v25. `extractSparkleId` moved to the new `server/lib/frontmatter.ts`.
- **`vault_path_source: "fallback"`** literal type narrowed away from `VAULT_READONLY` payloads. The union is now `"lookup" | null`.

### Added

- **Migration v25** — `ALTER TABLE items_vault DROP COLUMN export_path` plus a pre-flight `VACUUM INTO` snapshot to `~/sparkle-backups/`. Two halt categories: `migration_v25_halted_no_disk` (statfs free space < 1.2× DB size) and `migration_v25_halted_backup_failed` (mkdir / VACUUM threw). Backup is integrity-checked (`PRAGMA integrity_check` + schema_version + `export_path` column presence) BEFORE the destructive drop, so a corrupt VACUUM output never strands the operator with no rollback. Filename includes pid + uuid suffix to defeat collision under fast restart loops. Idempotent re-runs early-exit if the column is already gone.
- **`server/lib/frontmatter.ts`** — new shared module. `extractFrontmatterBlock(content)` returns the raw block with CRLF-stripped lines (was duplicated in vault-scanner + export.ts); `extractSparkleId(content)` calls it.
- **`vaultReadonlyResponse(c, sqlite, id, overrides?)`** — convenience helper in `server/lib/vault-errors.ts`. Five route callsites collapse from `getVaultPathBySparkleIdSync(...) → vaultReadonlyPayload(...) → c.json(..., 409)` to one line, coupling reverse-lookup with the payload shape.
- **`docs/migration-v25.md`** — six-section playbook (schema diff, pre-flight, halt categories, rollback with mandatory WAL/SHM cleanup, backup retention, post-deploy verification).
- **`ops/migration-25-dryrun.sh`** + **`ops/rollback-migration-25.sh`** — production-quality migration tooling matching the v23/v24 templates. Rollback derives the live DB owner via `stat` instead of hardcoding `tim:tim` so recovery hosts work too.

### Changed

- **`deleteVaultItem` return shape** — `{ id, vault_path: string | null }` (queried via LEFT JOIN inside the same transaction). `releaseVaultStub` API + MCP `sparkle_release_note` payload follow.
- **`useResolvedVaultPath` hook** — wrapped in `useMemo` so consumer dependency arrays stay stable across re-renders. The `export_path` snapshot fallback is gone; `resolvedVaultPath` is purely from reverse-lookup.
- **`item-detail` announce-on-change** — compares against the previously-rendered path (via `lastAnnouncedRef`) instead of the cached snapshot. No assistive-tech announcement on first load; only fires when reverse-lookup surfaces a different path post-rename.
- **`haltAndExit`** — accepts both `V24HaltPayload` and `V25HaltPayload` (`MigrationHaltPayload` union). Calls `logger.flush()` defensively before `process.exit(78)` for any future pino transport that buffers.

### Migration notes

- **Single-process pre-flight required.** Before deploying v25: `sudo systemctl stop sparkle && sleep 3 && pgrep -fc 'tsx server/index.ts'` should print `0`. Concurrent processes entering `runMigrations` would each VACUUM INTO once; idempotency holds, but two backups in the same dir confuses the operator.
- **Rollback requires WAL/SHM cleanup.** If you restore a v25 backup over the live DB without `rm -f data/todo.db-{wal,shm}` first, SQLite replays v25-era writes onto the v24 file and corrupts it. `ops/rollback-migration-25.sh` does this for you.
- **Reconnect Claude.ai connector** if you use one — the `vault_path_source` union narrowed; the connector picks up the updated tool descriptions on re-auth.
- See `docs/migration-v25.md` for the full halt-recovery runbook.

## [1.4.4.0] - 2026-04-30

### Added

- **vault_files reverse-lookup is now the primary path resolution mechanism.** `getVaultPathBySparkleId(id)` (server: `getVaultPathBySparkleIdSync(sqlite, id)`; client: `useVaultPathBySparkleId(id)` React Query hook) replaces direct reads of `items_vault.export_path`. Listings hydrate `vault_path` via a `LEFT JOIN vault_files ON vault_files.sparkle_id = items_vault.id` (both branches in `listVaultItems`). Single-row callsites (`vaultReadonlyPayload`) carry `vault_path_source: "lookup" | "fallback" | null` so AI agents and the UI can reason about freshness.
- **Migration v24** — backfills `vault_files.sparkle_id` from on-disk `.md` frontmatter for rows where it is currently NULL. Two-phase (sync I/O outside transaction, sync transaction for UPDATE + orphan check). Halts via `process.exit(78)` on either category: `migration_v24_halted_unparseable` (filesystem errors during PHASE 1) or `migration_v24_halted_orphans` (items_vault rows with no vault_files match after backfill). systemd unit gains `Restart=on-failure`, `RestartPreventExitStatus=78`, `SuccessExitStatus=78` so the halt is not looped — apply via `scripts/migrate-systemd-unit.sh`.
- **Export atomicity** — `commitExportToVault` now seeds `vault_files` (path, content, hash, mtime, sparkle_id) inside the same transaction that promotes items_active → items_vault. Reverse-lookup hits immediately after export (no 5-min scanner delay). New crash-recovery pre-check: if vault_files already records the sparkle_id but items_vault is missing, export aborts with `EXPORT_CRASH_RECOVERY` and the operator runs `npm run vault:reconcile`.
- **Vault sync CLIs** — `npm run vault:audit` (read-only inventory; flags backfill candidates + orphans; produces `scripts/vault-audit-report.json`), `npm run vault:probe` (PR 3 prerequisite verification), `npm run vault:reconcile` (interactive crash-window resolver + audit-report applier). All accept `--help` and `--batch=*` flags.
- **Reverse-lookup HTTP endpoint** (`GET /api/vault/by-sparkle-id/:id`) now returns `Cache-Control: private, max-age=60`. Client hook caches with 60s staleTime + `keepPreviousData` so renames stay clickable until the refetch lands.
- **AnnouncementProvider** (`src/components/announcement-provider.tsx`) — single sr-only `aria-live="polite"` region near the app root. `useAnnouncement()` consumers fire "vault 路徑已更新" when async reverse-lookup surfaces a path that differs from the cached snapshot. Outside the provider (test contexts), the hook returns a no-op.
- **MCP `vault-items` documentation subsection** (`mcp-server/src/docs/content.ts:data-model`) — explains items_active vs items_vault, why VAULT_READONLY occurs, recovery paths, and `vault_path_source` semantics. Resolves the formerly dead `sparkle://docs/data-model#vault-items` anchor referenced by `vault-errors.ts`.
- **Radix Tooltip primitive** (`src/components/ui/tooltip.tsx`, shadcn-style wrapper around `radix-ui`'s `Tooltip` package). Five item-detail-header callsites swapped from native `title=` to `<Tooltip>` for keyboard / screen-reader parity.

### Changed

- **`item-detail` slate bar** — three visual states (loading "索引更新中…" with `Loader2`, resolved with truncated path, deleted "此檔案已從 Vault 刪除") + `disabled:opacity-60` when no resolvable path. Aria-label tracks state. Mobile copy button has a 2-second post-export cooldown so the user doesn't tap before vault_files is queryable.
- **vault-watcher** — emits structured `vault_orphan_detected` log when ENOENT + sparkle_id reverse-lookup both fail. Self-heal logic retained as fallback during the dual-write window.
- **Item type** (`item-enrichment.ts:ItemWithLinkedInfo`) — adds `vault_path: string | null` field; `export_path` marked `@deprecated`.
- **`exportToObsidian` signature** — accepts an optional `sqlite` parameter for the crash-recovery pre-check. Tests that don't care can omit it; production routes always pass it. The disk-scan `findExistingBySparkleId` (O(N)) is replaced by `SELECT path FROM vault_files WHERE sparkle_id = ?` (O(log N) via partial index).

### Migration notes

- Bump systemd unit BEFORE redeploying: `sudo bash scripts/migrate-systemd-unit.sh && sudo systemctl daemon-reload`.
- Take a fresh restic backup; v23 backups are not v24-rollback-compatible.
- After deploy: `npm run vault:probe` should exit 0; `journalctl -u sparkle | grep vault_fallback_hit` should remain empty.
- See `docs/migration-v24.md` for full halt-recovery runbook.

## [1.4.3.0] - 2026-04-30

### Fixed

- **Vault scanner ordering bug** — files renamed or moved in Obsidian no longer lose their `sparkle_id` link. The scanner now DELETEs no-longer-on-disk rows BEFORE inserting new paths (wrapped in a sync transaction), avoiding the transient UNIQUE conflict on `sparkle_id` that previously caused new rows to fall back to `sparkle_id=NULL` permanently. Existing victim rows recover automatically on the next scan after PR 2 deploys; PR 1 alone stops new corruption.

### Added

- **Duplicate sparkle_id audit trail** — when two `.md` files share the same frontmatter `sparkle_id` (copy-paste collision), the scanner now appends a structured entry to `quality/duplicate-sparkle-id.json` (`{sparkle_id, new_path, detected}`) so PR 2's `vault:audit` CLI can surface the conflict to the operator. The existing `run(null)` fallback is preserved — both files remain indexed, one with the link, one without.
- **Concurrent-scan guard** — module-level `scanInProgress` boolean prevents two parallel `scanVaultFiles` runs when the 5-minute `setInterval` fires while a previous scan on a large vault is still in flight. Wrapped in `try/finally` so the guard always resets on errors.

### Changed

- **Vault list capacity** — `/vault` page now shows up to 200 results (was 30). Server `/api/vault?limit=` cap raised to 500. Closes the symptom where 71+ vault files only displayed 30 entries.
- **`scanVaultFiles` signature** — now accepts an optional `{ auditPath?: string }` options bag; `skipped: false` is always defined on the return shape (was `skipped?: boolean`) for callers' clarity.

### Infrastructure

- `quality/duplicate-sparkle-id.json` is gitignored as a runtime artifact.
- New tests: `path-rename does not produce NULL sparkle_id`, `appends duplicate sparkle_id audit entry to JSON file`, `skips concurrent scan when one is already in progress` (3 cases, all in `server/lib/__tests__/vault-scanner.test.ts`).

## [1.4.2.0] - 2026-04-25

### Added

- **Dashboard "最近活動" now surfaces vault exports** with an `匯出` activity badge (slate). Vault rows are merged from `items_vault` into `getRecentItems` via a 2-SELECT + JS merge, keyed by `exported_at`. Clicking a vault row navigates to `/item/:id` (the universal resolver) instead of the removed `/notes/exported` route.
- **Week view `notes_modified` includes vault exports** for the day they were exported, using `exported_at` as the event timestamp. Entries render with `status: 'exported'`.
- **Category distribution includes items_vault** — per-category counts sum across active + vault, so categories remain visible after their only member is exported.
- **Daily note `活躍筆記` section includes vault exports** for the generated day (labeled `(exported, 今日修改)`).
- **`docs/migration-v23.md`** — 6-section self-hoster guide: schema summary, query translations, 13-tool MCP behavior diff, upgrade steps, rollback constraints, Claude.ai connector reconnect.
- **`server/db/README.md`** — 6-section WHY doc for the two-table split: rationale, cross-table FK + app-layer constraints, FTS5 scope, dry-run protocol, DB-state check queries, rollback procedure.
- **MCP instruction `## 資料模型` section** — explains the two-table model, item removal paths, and `VAULT_READONLY` error handling to MCP clients (rebuilt `mcp-server/dist`).

### Changed

- `CLAUDE.md` data-model line rewritten around the items_active / items_vault split; documents the `VAULT_READONLY` return from MCP + REST mutations on vault rows.
- `ActivityType` extended with `"exported"` in both `server/lib/stats.ts` and `src/lib/types.ts`; `ActivityBadge` gains the slate "匯出" style.

### Tests

- New: `server/lib/__tests__/stats-vault-merge.test.ts` — 10 cases across `getRecentItems`, `getWeekData`, `getCategoryDistribution` covering vault inclusion, private filtering, sort order, and limit/offset pagination over the union.
- New: `generateDailyNote — items_vault merge` describe block in `daily-note.test.ts` — 2 cases (happy path + private filter).

## [1.4.1.0] - 2026-04-24

### Added

- **Vault stub release** — `DELETE /api/items/:id/vault-stub` hard-deletes an `items_vault` row and nulls the matching `vault_files.sparkle_id` atomically. vault .md is preserved; Sparkle just stops tracking it. Linked todos become dangling (rendered as `linked_note_origin: 'missing'`). Endpoint returns **409 `ALREADY_RELEASED`** on an unknown id (idempotent re-release path) and **404 `NOT_VAULT_ITEM`** on an active-item id.
- **Content-snippet preview** — vault detail view renders `content_snippet` as a read-only `<pre>` (`whitespace-pre-wrap break-words max-h-32 overflow-hidden` + gradient fade) per plan item 16; prevents the horizontal-overflow regression from PRs #298-#301. Label: `內容預覽 · 節錄前 500 字；完整內容請至 vault 查看`.
- **在 Obsidian 中開啟 link** — `obsidian://open?vault=<basename>&file=<relpath>` URI next to the snippet. Vault name derived from `obsidian_vault_path` basename via a cached `/api/settings` query (only fetched for vault-origin items).
- **Release redirect + focus return** — post-release `ExportedItemView.onDeleted` navigates to `/notes/fleeting` (per design) and focuses the new page's `<h1>` (`tabindex=-1`) so keyboard users land where they can continue triaging.
- **MCP `sparkle_release_note`** — wraps the vault-stub endpoint; requires `confirm: true` + vault-origin pre-check.
- **Header vault-origin indicator bar** (slate-50 / dark:slate-800, `FolderOpen` icon, click-to-copy `export_path`) sits below the type indicator. Slate was chosen because amber is reserved for paused.
- **Release button + dialog** replaces the trash icon when `origin === 'vault'`: destructive variant, reuses the existing `<Dialog>` primitive, copy per the plan (`釋出 Sparkle 記錄` / `Sparkle 將不再記錄這筆筆記。vault 檔案 {export_path} 保留不變動。`).
- **Dangling linked-note UX** — `linked-items-section.tsx` now branches on `linked_note_origin`:
  - `active` → `FileText` + title + `解除關聯`
  - `vault` → `FolderOpen` + title + `位於 vault 內` muted badge
  - `missing` → destructive `AlertTriangle` + `此連結已失效（vault 中找不到檔案）` + short-id prefix + `解除關聯`; sonner `toast.warning` fires once per item on first missing render.
  - `vault-stale` (linked_note_id set but origin absent) → `animate-pulse` skeleton.
- Tests: 5-case route suite (`items-vault-stub.test.ts`) including D2 dangling verification via FK-bypassed seed; 6-test E2E spec (`vault-release.spec.ts`); component tests for all three dangling states + missing-state toast; MCP tests for confirm-false / non-vault / happy / API-failure paths.

### Changed

- `use-item-actions.ts` exposes `handleRelease` + `releasing`. 404 from vault-stub collapses to `此筆記已釋出` toast (idempotent); other failures to `釋出失敗，請重試`.
- `linked-items-section.tsx` reads `linked_note_title` / `linked_note_origin` / `linked_note_prefix` from the enriched item response directly, dropping the redundant `getItem` fetch.

## [1.4.0.0] - 2026-04-24

### BREAKING

- **Database schema**: `items` table split into `items_active` (fleeting/developing/permanent/archived) and `items_vault` (exported metadata + 500-char `content_snippet`). Existing raw SQL queries against `items` will fail. Dry-run: `ops/migration-23-dryrun.sh`. Rollback: `ops/rollback-migration-23.sh`.
- **REST API**: `DELETE /api/items/:id` on an exported item now returns `409 Conflict` with `VAULT_READONLY` payload (was: hard delete pre-v1.4.0). Release endpoint (`DELETE /api/items/:id/vault-stub`) ships in v1.4.1.
- **MCP tools**: `sparkle_update_note`, `sparkle_pause_note`, `sparkle_resume_note`, `sparkle_advance_note` return `VAULT_READONLY` (409) on vault items. `sparkle_search` no longer returns exported items — use `sparkle_search_obsidian` or `sparkle_search_all`. `sparkle_list_notes` default excludes vault; pass `status='exported'` to access.
- **UI**: Revert button removed from exported notes. Exported is now one-way; use the vault-stub release endpoint (v1.4.1) if the record truly needs to leave Sparkle.
- **Claude.ai users**: reconnect the Sparkle MCP connector after upgrading to pick up new tool descriptions.

### Added

- `items_vault.content_snippet` — 500-char immutable preview, captured at export time.
- `ops/migration-23-dryrun.sh` — validates row count, FK integrity, viewed_at preservation, content_snippet overflow, and idempotency on a copy of the production DB.
- `ops/rollback-migration-23.sh` — stop/restore/checkout/rebuild/start with schema-version sanity check and named-branch checkout (no detached HEAD).
- `server/lib/vault-errors.ts` — single source for `VAULT_READONLY` 409 payload, shared by routes and MCP.
- Pre-commit hook blocks raw `FROM|UPDATE|DELETE FROM items` references (word-boundary matched, excludes `server/db/index.ts` migration code and `server/db/__tests__/migration*.test.ts` pre-v23 regression tests).
- 14 migration-v23 regression tests: Stage A row count, viewed_at preservation, category cascade-null, share_tokens drop-count, cross-table linked_note_id cleanup, content_snippet derivation, CHECK constraint enforcement, pre-scan violation detection, idempotency (State B / State C / inconsistent-state error), FK pragma safety.
- `GET /api/items?include_vault=true` and `sparkle_list_notes({include_vault:true})` — cross-table merge escape hatch that returns items_active + items_vault rows interleaved, sorted on the caller's requested field.
- `GET /api/items?status=exported` and `sparkle_list_notes({status:'exported'})` — vault-only listing (previously rejected by Zod as invalid status).
- `listVaultItems` now supports `tag` filter via `json_each(items_vault.tags)` SQL so vault pagination is correct when the caller filters by tag.
- 11 new unit/route tests for the cross-table list modes + 4 MCP tests covering the `include_vault` handler passthrough and URL encoding.

### Fixed

- MCP `tools.test.ts` description regex now matches the v1.4.0 `VAULT_READONLY` phrasing (the old regex looked for "exported...read-only" wording that was removed when the tool descriptions were rewritten).
- `DELETE /api/private/items/:id` on a vault-origin item now returns `409 VAULT_READONLY` instead of silently responding `204` on a no-op delete (the handler used to claim success while `items_active` had no matching row to delete). Symmetric with the public `DELETE /api/items/:id` guard.
- LINE `!archive` and `!delete` commands on a vault-origin item now return the "cannot edit from LINE" message instead of falsely claiming `✅ 已封存` / `🗑️ 已刪除` while `updateItem` / `deleteItem` silently no-op on vault rows.

### Added (test coverage)

- Route-layer VAULT_READONLY test suite (`server/routes/__tests__/items-vault-readonly.test.ts`): 13 tests covering GET/PATCH/DELETE/POST-share/POST-export/batch/linked-todos + private CRUD guards, asserting the complete VAULT_READONLY payload shape end-to-end.
- Lib-layer atomicity + wikilink tests: 8 new `commitExportToVault` cases (happy path, snippet truncation at 500 chars, empty/null content, boundary, is_private propagation, transaction rollback on PK conflict) and 12 new `getItemForLookup` cross-table cases (unique active/vault, cross-table collision → null, intra-table collision, short-prefix guard, full UUID match, private-row skip).
- Rewrote three post-v23 test files: `vault-watcher.test.ts` (10 self-heal debounce / fs-mock cases), `vault-sync-integration.test.ts` (4 export→scan cycle cases), `item-handlers.test.ts` (19 LINE handler guard cases using parametrized `it.each`).
- `server/test-utils.ts` — shared `insertActiveRow` / `insertVaultRow` row-fixture helpers with schema-aware defaults (status enum, JSON-array columns, paused semantics); replaces 6 near-duplicate hand-rolled helpers across 5 test files.

### Changed

- `server/db/fts.ts` — `items_fts` → `items_active_fts`.
- `server/lib/stats.ts getStats` — two-query rewrite; `exported_this_{week,month}` now keyed by `items_vault.exported_at`.
- `server/lib/vault-watcher.ts` — content-sync removed; self-heal gets 2-scan debounce + DEBUG→WARN escalation so boot-window ENOENT doesn't log-spam.
- `server/lib/item-enrichment.ts` — `ItemWithLinkedInfo` gains `origin: 'active' | 'vault'` marker + `linked_note_origin` + `linked_note_prefix` for future dangling-todo UX.
- `server/lib/export.ts commitExportToVault` — file-write-first, tx-after atomic move of items_active → items_vault.
- `server/routes/items.ts` — cross-table `GET /:id` (active first, vault fallback); `POST /:id/export` uses `commitExportToVault`; batch export counter is O(n) not O(n²).
- MCP tool descriptions rewritten to reflect the split; `sparkle_advance_note` precheck rejects vault-origin with `VAULT_READONLY` instead of a misleading "must be developing" error.
- `server/lib/items.ts listItems` split into a dispatcher + private `listActiveItems` helper so `listItemsAcross` can call the active path directly (no recursion through the public entry point).
- `server/schemas/items.ts listItemsSchema.offset` capped at `10_000` to prevent memory amplification under `include_vault=true` (fetches `limit + offset` from each table).
- `listItemsSchema.status` reuses `importStatusEnum` instead of redefining the same 8 values inline.
- `server/lib/line-commands/item-handlers.ts` — `EXPORTED_MSG` now exported so tests import it instead of re-declaring the literal (drift protection).

### Removed

- Revert button and `handleRevert` flow from item-detail UI (exported notes are one-way).
- vault-watcher content-sync plumbing (`contentHash`, `stripFrontmatter`, mtime content cache). Vault edits no longer round-trip into Sparkle's DB — vault is the content source of truth post-export.
- `server/lib/exported-guard.ts` (`EXPORTED_BLOCKED_FIELDS`) — superseded by the route-layer 409.

### Deferred (PR 2/3)

- `DELETE /api/items/:id/vault-stub` release endpoint + `sparkle_release_note` MCP tool.
- Vault-origin visual treatment (third indicator bar) + dangling linked-todo UX (3 states).
- Dashboard query audit (recent / weekData / categoryDistribution / daily-note 2-SELECT+merge).
- `docs/migration-v23.md` + `server/db/README.md` migration guides.
- `CLAUDE.md` / `.claude/skills/*` data-model section sync.

## [1.3.3.0] - 2026-04-09

### Added

- Obsidian 相容的 markdown 文字排版：單行換行顯示為換行（remark-breaks）、`==highlight==` 顯示為螢光標記、`> [!NOTE]` 等 callout 顯示為有樣式的方塊
- 共用 markdown 配置模組（`markdown-config.tsx`），統一兩個預覽元件的 plugin 和 component 設定
- 11 個新渲染測試涵蓋換行、code block、highlight、callout 功能

### Fixed

- 無語言 fenced code block 現在正確顯示為區塊樣式（pre/code 職責分離取代 className 偵測）

## [1.3.2.4] - 2026-04-07

### Fixed

- Vault 檔案選取狀態 F5 刷新後遺失：URL search param 成為唯一 source of truth，移除冗餘的 React state

## [1.3.2.3] - 2026-04-07

### Fixed

- Vault detail panel 仍溢出：巢狀 flex child 也需要 `min-w-0`，content area 加上 `overflow-x-hidden` 防止 markdown 內容溢出

## [1.3.2.2] - 2026-04-07

### Fixed

- Vault 頁面寬內容溢出 / 短內容縮排問題，根元素加上 `flex-1 min-w-0` 與其他 route 一致

### Added

- E2E layout overflow 測試：6 個 route x 2 個 viewport，防止 flex layout 回歸
- CLAUDE.md 新增 route layout contract 慣例

## [1.3.2.1] - 2026-04-07

### Added

- Dual-layer discovery strategy: grep taxonomy (Layer 1) + exploratory testing (Layer 2) targeting the "negative space" of grep patterns
- Charter seeds (探索測試種子) for all 12 defect taxonomy categories in `quality/defect-taxonomy.md`
- `quality/discovery-strategy.md`: dual-layer model, category mapping, trigger conditions, pattern promotion criteria, success metrics
- `quality/et-charter-template.md`: SBTM 4T session template for structured exploratory testing
- `quality/et-sessions/` directory for ET session records
- Discovery-method dropdown in all 4 issue templates (defect, tech-debt, feature-gap, test-infra)
- 4 GitHub labels: `discovery-method:{taxonomy-sweep,et-session,code-review,production}`
- `discovery-method:` row in quality README label taxonomy table

### Changed

- Updated defect-category placeholder in `defect.yml` to list all 12 D-XXX codes
- Quality skill reorganized with ET operations, staleness trigger (>60 days), and manual label application notes

## [1.3.2.0] - 2026-04-06

### Removed

- "全部" nav entry from sidebar and bottom-nav (replaced by universal item resolver)

### Added

- `/item/:id` universal resolver route: fetches item type+status, redirects to correct list view with auto-selection
- Standalone detail view for exported items at `/item/:id` (read-only with "回到 Vault" breadcrumb)
- `/all` backward-compatible redirect route (forwards `?item=` to resolver, else dashboard)
- `onBack`, `onDeleted`, `onNavigate` props on ItemDetail for standalone context support
- Unit tests for type+status→path mapping (11 test cases)

### Changed

- Vault "在 Sparkle 中查看" and Share Management item clicks now use `/item/:id` resolver
- Typed TanStack Router params for `/item/$id` navigation (vault.tsx, shares.tsx)

## [1.3.1.1] - 2026-04-06

### Changed

- Move `deriveTitleFromContent` from route handler to `server/lib/title-derivation.ts`

### Added

- Integration tests for private route auto-title (8 tests)
- E2E tests for private note advancement title confirmation modal (2 tests)
- E2E helpers: `setupPrivatePin` and `createPrivateItemViaApi`

## [1.3.1.0] - 2026-04-06

### Changed

- Note detail view defaults to preview mode instead of edit mode
- Switching between notes resets to preview mode (was edit mode)
- ItemContentEditor resets preview state on item navigation via key prop

## [1.3.0.0] - 2026-04-06

### Added

- Quick Capture: multi-line textarea for notes and scratches (todo keeps single-line input)
- Auto-title: server derives title from first non-empty line of content (max 80 chars)
- Title confirmation modal: prompts to confirm/edit title when advancing auto-titled notes
- Keyboard hint: "Enter 換行 | ⌘+Enter 送出" shown below textarea on desktop (auto-dismisses after 5 submissions)
- Submit button spinner during pending state

### Changed

- Quick Capture keyboard behavior: Enter creates newline (was submit), Cmd/Ctrl+Enter submits (breaking change)
- Notes and scratches send content to API instead of title; server handles title derivation
- Title field now optional in create item API for note/scratch types (todo still requires title)

## [1.2.7.0] - 2026-04-06

### Added

- Vault page: "From Sparkle" filter toggle to show only Sparkle-sourced files
- Vault page: sparkle badge (✦) on search results from Sparkle
- Vault page: "來自 Sparkle" banner with "在 Sparkle 中查看" link in detail view
- Item detail: "在 Vault 中查看" link now resolves via sparkle_id API (replaces static export_path)

### Changed

- "已匯出" page replaced with redirect to `/vault?filter=sparkle`
- Sidebar: "已匯出" removed, "Vault 瀏覽" moved into notes section
- Query keys include filter param to prevent stale cache after toggle

### Removed

- Standalone "已匯出" page (now served by vault browse with filter)

## [1.2.6.0] - 2026-04-06

### Added

- Vault search API: `filter=sparkle` query param to show only Sparkle-sourced files
- Vault search API: `sparkle_id` included in search results
- New endpoint `GET /api/vault/by-sparkle-id/:id` resolves vault path from sparkle_id (UUID validated)
- Vault watcher self-healing: auto-corrects broken export_path via sparkle_id lookup when file not found

## [1.2.5.0] - 2026-04-06

### Added

- sparkle_id column in vault_files table (migration v22) for linking vault files to Sparkle source items
- Vault scanner extracts sparkle_id from YAML frontmatter during scan
- Unique partial index on sparkle_id prevents duplicate assignments
- Migration invalidates content_hash + mtime for files with sparkle_id, forcing re-scan to populate the new column
- Graceful duplicate sparkle_id handling: second file gets null instead of crashing

### Changed

- extractFrontmatter now handles \r\n line endings (Windows/Obsidian compatibility)
- extractSparkleId regex updated for \r\n support
- Vault scanner upsert refactored with upsertWithDupGuard helper (70 lines → 6)

## [1.2.4.0] - 2026-03-30

### Fixed

- Remove category from Obsidian export frontmatter (no native Obsidian equivalent)
- Skip auto-generated H1 title when note content already starts with one
- Normalize tags on export: lowercase, spaces→hyphens, deduplicate
- Resolve Sparkle ID references (`筆記（id）`) to Obsidian wikilinks (`[[title]]`)
- Sanitize wikilink-breaking characters in titles (`]]`, `[[`, `|`, newlines)

### Changed

- Extract shared lookupItem function for export reference resolution
- Align wikilink title sanitization with existing daily-note.ts safeTitle()

## [1.2.0](https://github.com/hottim900/sparkle/compare/v1.1.1...v1.2.0) (2026-03-29)

### Features

- add categories CRUD API and integrate into items ([#53](https://github.com/hottim900/sparkle/issues/53)) ([5c92035](https://github.com/hottim900/sparkle/commit/5c920356204bb66186b25dc0bdd7ad7789ad5e1f))
- add categories table and category_id to items (migration 12→13) ([#52](https://github.com/hottim900/sparkle/issues/52)) ([333638d](https://github.com/hottim900/sparkle/commit/333638d0b29b1f2da6ef2930e792233895761e2a))
- add category frontend UI, MCP tools, and documentation ([#54](https://github.com/hottim900/sparkle/issues/54)) ([f972e36](https://github.com/hottim900/sparkle/commit/f972e36bcb858714bebaa9d5ec1c0f9f845a2e7b))
- add category management UI ([#72](https://github.com/hottim900/sparkle/issues/72)) ([59e50b4](https://github.com/hottim900/sparkle/commit/59e50b4aaba536a163db047503c7e67f18f0e852))
- add category select to fleeting triage ([#58](https://github.com/hottim900/sparkle/issues/58)) ([2af02fb](https://github.com/hottim900/sparkle/commit/2af02fbf4fe343bf53ceab84d6394c12de5e3431))
- add PIN-protected private notes ([#192](https://github.com/hottim900/sparkle/issues/192)) ([#194](https://github.com/hottim900/sparkle/issues/194)) ([9f08970](https://github.com/hottim900/sparkle/commit/9f08970f4ae907706af16685d24b257d8b87295a))
- add standalone share management page ([#49](https://github.com/hottim900/sparkle/issues/49)) ([8e4424d](https://github.com/hottim900/sparkle/commit/8e4424de70ac01d0013223a125b8e74be8fcf0c2))
- **api:** add dashboard endpoints and viewed_at tracking ([#170](https://github.com/hottim900/sparkle/issues/170)) ([ed6458e](https://github.com/hottim900/sparkle/commit/ed6458eb099e300864f30985fb4e038c85b74046))
- **api:** add LINE daily brief manual trigger and settings UI ([#236](https://github.com/hottim900/sparkle/issues/236)) ([#237](https://github.com/hottim900/sparkle/issues/237)) ([050dc77](https://github.com/hottim900/sparkle/commit/050dc77acea3eedab748e83051bf02cb286b98fc))
- **api:** add LINE daily brief push notification ([#236](https://github.com/hottim900/sparkle/issues/236)) ([a091144](https://github.com/hottim900/sparkle/commit/a091144ccd6ba89a50ee202535ef942bf2657266))
- **api:** add Obsidian daily note generator ([#219](https://github.com/hottim900/sparkle/issues/219)) ([#232](https://github.com/hottim900/sparkle/issues/232)) ([c3f4c48](https://github.com/hottim900/sparkle/commit/c3f4c48aa7607f1477e84050e67dd5bcb3c0c28e))
- **api:** add week data endpoint for temporal bridge ([#219](https://github.com/hottim900/sparkle/issues/219)) ([883dc17](https://github.com/hottim900/sparkle/commit/883dc17b26bb95ffa849f1efd0fbeaafda222d5e))
- **db:** add is_private column (migration v15) ([#193](https://github.com/hottim900/sparkle/issues/193)) ([b3fbb72](https://github.com/hottim900/sparkle/commit/b3fbb72476e9e9384c448e6ba1cf1cc8e7220301))
- **db:** add viewed_at column and dashboard settings (migration 14) ([#169](https://github.com/hottim900/sparkle/issues/169)) ([249bf7c](https://github.com/hottim900/sparkle/commit/249bf7c0c69be809661651e2f7e78cf967fde129))
- display item ID in detail view metadata ([#85](https://github.com/hottim900/sparkle/issues/85)) ([7a491e9](https://github.com/hottim900/sparkle/commit/7a491e91b39e2965153e70e9d00ca8b05e57d19f))
- **frontend:** add daily note settings UI and settings E2E tests ([#248](https://github.com/hottim900/sparkle/issues/248)) ([69ddf96](https://github.com/hottim900/sparkle/commit/69ddf969b30a941751490268c8baf49a409823a2))
- **frontend:** add idle timer and improve private notes lock mechanism ([#202](https://github.com/hottim900/sparkle/issues/202)) ([771fdf9](https://github.com/hottim900/sparkle/commit/771fdf97ed91b10b2bd94d990a25dc2b970d467c))
- **frontend:** add WeekView component to dashboard ([#225](https://github.com/hottim900/sparkle/issues/225)) ([7fc3548](https://github.com/hottim900/sparkle/commit/7fc354868f70254bb8861f48a8d30f78b5c3cfe4))
- **frontend:** replace 最近新增 dashboard card with 最近活動 ([#218](https://github.com/hottim900/sparkle/issues/218)) ([23836a7](https://github.com/hottim900/sparkle/commit/23836a7c64a2c1b7da876ba15f44f98a8745e898))
- **mcp:** add dashboard query tools and set origin on create ([#172](https://github.com/hottim900/sparkle/issues/172)) ([f8ce004](https://github.com/hottim900/sparkle/commit/f8ce004df898e666e0e2d51e56e242415eb2c59c))
- **mcp:** add HTTP transport with OAuth for Claude.ai connector ([#143](https://github.com/hottim900/sparkle/issues/143)) ([d775883](https://github.com/hottim900/sparkle/commit/d7758839d3000c510cc63714645a1a6a0e581853))
- **mcp:** add list filters (category, order) and pagination info ([#159](https://github.com/hottim900/sparkle/issues/159)) ([4520ad5](https://github.com/hottim900/sparkle/commit/4520ad5d6264ab5037a294f4187cf237735024cf))
- **mcp:** add Obsidian vault read/write tools ([#152](https://github.com/hottim900/sparkle/issues/152)) ([5720bfb](https://github.com/hottim900/sparkle/commit/5720bfb1969767802163dcdd87847184eedcd8c6))
- **mcp:** add Obsidian vault search and list tools ([#153](https://github.com/hottim900/sparkle/issues/153)) ([9eee0d4](https://github.com/hottim900/sparkle/commit/9eee0d4831e23b2f29d57f02a37f3c440fbfa8cf))
- **mcp:** add unified search across Sparkle and vault ([#154](https://github.com/hottim900/sparkle/issues/154)) ([44d9df4](https://github.com/hottim900/sparkle/commit/44d9df464508e433d0354e0441e6c201b252a9a7))
- migrate to TanStack Router file-based routing ([#97](https://github.com/hottim900/sparkle/issues/97)) ([0a58278](https://github.com/hottim900/sparkle/commit/0a58278d3a04b934839461a92d58234d8cf07a19))
- move metadata below title in detail view ([#86](https://github.com/hottim900/sparkle/issues/86)) ([4c22b7a](https://github.com/hottim900/sparkle/commit/4c22b7a8340d8fad8ca32276683d583905dc452f))
- **ops:** add systemd service and deploy workflow for MCP HTTP server ([#146](https://github.com/hottim900/sparkle/issues/146)) ([d78d870](https://github.com/hottim900/sparkle/commit/d78d870ac4db075633b770a32bd6df52c48042e8))
- redesign dashboard with Zettelkasten flow focus ([#74](https://github.com/hottim900/sparkle/issues/74)) ([9ea103a](https://github.com/hottim900/sparkle/commit/9ea103a246ed620e8f031e97ee0cdf2ccc26f04a))
- **settings:** add Obsidian Daily Note settings UI ([#238](https://github.com/hottim900/sparkle/issues/238)) ([#240](https://github.com/hottim900/sparkle/issues/240)) ([28283d3](https://github.com/hottim900/sparkle/commit/28283d39da74a3e746a0592df4034841d5c1b713))
- **share:** add TOC, back-to-top, and modified date to public page ([#150](https://github.com/hottim900/sparkle/issues/150)) ([6bddde4](https://github.com/hottim900/sparkle/commit/6bddde4c990dbc3107385a73752a1d4c2c3506eb))
- show category color dot in list group headers ([#73](https://github.com/hottim900/sparkle/issues/73)) ([6b4003e](https://github.com/hottim900/sparkle/commit/6b4003e85fe9dd89440087f94aecc899d9f5bf68))
- show short ID with click-to-copy full UUID ([#87](https://github.com/hottim900/sparkle/issues/87)) ([62e2fc1](https://github.com/hottim900/sparkle/commit/62e2fc11e84eee3cd013f213465e1a4587afe870))
- support short ID prefix lookup in GET /api/items/:id ([#89](https://github.com/hottim900/sparkle/issues/89)) ([3840c54](https://github.com/hottim900/sparkle/commit/3840c540246d0d3d0edae6ca2c898494b3ea6b42))
- **ui:** redesign dashboard with unreviewed/recent/attention cards ([#173](https://github.com/hottim900/sparkle/issues/173)) ([0ffd7d2](https://github.com/hottim900/sparkle/commit/0ffd7d2b14f8cae4bb14bd13e621456b96e4f369))

### Bug Fixes

- add aria-label to all icon-only buttons (FG-001) ([#107](https://github.com/hottim900/sparkle/issues/107)) ([68d185c](https://github.com/hottim900/sparkle/commit/68d185c4d69abeed093e3d7041e16427ea38327e))
- add error boundary to LINE command dispatcher (TD-016) ([#128](https://github.com/hottim900/sparkle/issues/128)) ([d49d86e](https://github.com/hottim900/sparkle/commit/d49d86ee8a1916223eec0c094b96ce9f35d56b63))
- add error logging to LINE search catch and harden short ID prefix lookup (DEF-012, DEF-013) ([#100](https://github.com/hottim900/sparkle/issues/100)) ([070fcf6](https://github.com/hottim900/sparkle/commit/070fcf6c4e82e434ec4ed4101fc2eaf5909509a1))
- add ErrorBoundary to list Outlet and error state UI (DEF-015, DEF-016) ([#106](https://github.com/hottim900/sparkle/issues/106)) ([1b5f505](https://github.com/hottim900/sparkle/commit/1b5f505868d4d758624f69d59873371ad86a08c1))
- add export API result limit (DEF-009) ([#78](https://github.com/hottim900/sparkle/issues/78)) ([3579de7](https://github.com/hottim900/sparkle/commit/3579de7c3daa9a39dc2483527a1755a42c1d35b8))
- add format:check to pre-commit and coverage check to pre-push ([#233](https://github.com/hottim900/sparkle/issues/233)) ([7ccd422](https://github.com/hottim900/sparkle/commit/7ccd4220bb9617be10f92da7811b5d53c1550da8))
- add offline sync failure notification and status SSOT guard ([#65](https://github.com/hottim900/sparkle/issues/65)) ([a57a86f](https://github.com/hottim900/sparkle/commit/a57a86fccf251bba31e29909e149fe33e758b35c))
- add response.ok check to SW replayQueue and safe JSON parse (DEF-001, DEF-008) ([#76](https://github.com/hottim900/sparkle/issues/76)) ([76ab455](https://github.com/hottim900/sparkle/commit/76ab455461b08993812e8659385a83d4a1ad1dbd))
- add revoke confirmation dialog, accessibility, and E2E tests for share management ([#51](https://github.com/hottim900/sparkle/issues/51)) ([2222f34](https://github.com/hottim900/sparkle/commit/2222f3483cddba942e35cdf7c34517288054589b))
- address week data issues from Phase 1 review ([#220](https://github.com/hottim900/sparkle/issues/220), [#221](https://github.com/hottim900/sparkle/issues/221), [#222](https://github.com/hottim900/sparkle/issues/222)) ([#224](https://github.com/hottim900/sparkle/issues/224)) ([4183b4f](https://github.com/hottim900/sparkle/commit/4183b4f94c2a6124f1787fd57415bd3f6e66f678))
- auto-focus category create input after Radix Select closes ([#57](https://github.com/hottim900/sparkle/issues/57)) ([cc84d60](https://github.com/hottim900/sparkle/commit/cc84d609770e48c32b216bd0d1241dbbedff579d))
- auto-reload on CF Access session expiry instead of showing error ([#96](https://github.com/hottim900/sparkle/issues/96)) ([b1c2084](https://github.com/hottim900/sparkle/commit/b1c2084ec912f1edb0cfed57f87228b3de4762bc))
- **backend:** replace SELECT \*, extract share tag parser, narrow export mode type ([#163](https://github.com/hottim900/sparkle/issues/163)) ([07f1556](https://github.com/hottim900/sparkle/commit/07f155612563d939ba0832f6dcd1e942ab7cfd7c))
- **backup:** replace deprecated restic --repo2 with --from-repo ([#165](https://github.com/hottim900/sparkle/issues/165)) ([1cccefa](https://github.com/hottim900/sparkle/commit/1cccefaa609e309938452d3e1a157e160c742c0c))
- close DEF-010 and DEF-011 quality defects ([#99](https://github.com/hottim900/sparkle/issues/99)) ([6b7d2fa](https://github.com/hottim900/sparkle/commit/6b7d2fa501f8f28d25571fd2aba117087dd21ab7))
- close DEF-012, DEF-013, DEF-014 quality defects ([#101](https://github.com/hottim900/sparkle/issues/101)) ([8696f15](https://github.com/hottim900/sparkle/commit/8696f15d5ff9ae7a372d6fc1c3c23336682b6244))
- close quality defects and improve AI dev efficiency (DEF-012~014, TD-003, TD-007~008, FG-002) ([#103](https://github.com/hottim900/sparkle/issues/103)) ([26a0f63](https://github.com/hottim900/sparkle/commit/26a0f633876521b2f55abaf8ed907cce48680c62))
- complete React Query invalidation and adjust staleTime (DEF-002, TD-002) ([#77](https://github.com/hottim900/sparkle/issues/77)) ([507274c](https://github.com/hottim900/sparkle/commit/507274c1a5aeb0d0f6cfe3b5317918e79c8fe9bf))
- **db:** add migration v17 for LINE brief settings defaults ([#239](https://github.com/hottim900/sparkle/issues/239)) ([0b9e5df](https://github.com/hottim900/sparkle/commit/0b9e5dfa379c4f1b83b441c29d77f05f3d9b9ab6))
- deduplicate invalidation hooks + invalidate linkedTodos on status change ([#134](https://github.com/hottim900/sparkle/issues/134)) ([7746a24](https://github.com/hottim900/sparkle/commit/7746a24579caff63b83c9aa7c4c580a2a706d69a))
- don't serve stale API cache when online and fetch fails ([#90](https://github.com/hottim900/sparkle/issues/90)) ([b9e54d8](https://github.com/hottim900/sparkle/commit/b9e54d8edfaa2b41bf2e9a2105d74af16c534328))
- eliminate fixed-positioning layout pollution in mobile view ([#62](https://github.com/hottim900/sparkle/issues/62)) ([f42567c](https://github.com/hottim900/sparkle/commit/f42567c04e6da47ebd1f929354ac90da691a71be))
- eliminate silent failures and harden error handling ([#64](https://github.com/hottim900/sparkle/issues/64)) ([e755e6d](https://github.com/hottim900/sparkle/commit/e755e6d9db7298eb39a089f0b5aa5a0eabd14581))
- **export:** collision timestamp seconds, timezone offset, idempotent guard ([#161](https://github.com/hottim900/sparkle/issues/161)) ([d328fda](https://github.com/hottim900/sparkle/commit/d328fda481c429dfa558feb91b133b9873174b57))
- **export:** YAML frontmatter escaping, JSON parse error handling, ExportMode type ([#156](https://github.com/hottim900/sparkle/issues/156)) ([7a0eb72](https://github.com/hottim900/sparkle/commit/7a0eb7222edd587ff6e012a97beaae191b8d38eb))
- extract hex color constant, align sort_order max, hoist timestamp ([#138](https://github.com/hottim900/sparkle/issues/138)) ([0d61f33](https://github.com/hottim900/sparkle/commit/0d61f334560a4909399e0199252e02953c9fbfdf))
- forward enrich param in all resolveLinkedInfo call sites ([#115](https://github.com/hottim900/sparkle/issues/115)) ([1f571da](https://github.com/hottim900/sparkle/commit/1f571dabc83f5caa1189019164b02a79936ed05d))
- **frontend:** add private notes entry to mobile bottom navigation ([#214](https://github.com/hottim900/sparkle/issues/214)) ([1b700d8](https://github.com/hottim900/sparkle/commit/1b700d854a1d708a64e0cb2afbeb9eb726f11143))
- **frontend:** auto-clear lock overlay to reveal PIN unlock view ([#203](https://github.com/hottim900/sparkle/issues/203)) ([fb20494](https://github.com/hottim900/sparkle/commit/fb2049483a8c040f8a6eaa79df7a9eef8165f032))
- **frontend:** fix private notes post-setup redirect and delete error ([#200](https://github.com/hottim900/sparkle/issues/200)) ([3f9e492](https://github.com/hottim900/sparkle/commit/3f9e492ab437704917543ed12ae30d31f9af6d5d))
- **frontend:** keep mobile bottom nav visible when detail panel is open ([#217](https://github.com/hottim900/sparkle/issues/217)) ([d143897](https://github.com/hottim900/sparkle/commit/d143897cbb7016eb885573b4fff79e2a676fdd6b))
- **frontend:** WeekView review fixes — invalidation, React keys, cross-year header ([#227](https://github.com/hottim900/sparkle/issues/227)) ([32e7cda](https://github.com/hottim900/sparkle/commit/32e7cda9076cbd006a3e0a3684f01add02e62eef))
- **frontend:** weekView state management and keyboard shortcut fixes ([#242](https://github.com/hottim900/sparkle/issues/242)) ([1cfe32a](https://github.com/hottim900/sparkle/commit/1cfe32ad763f96d41f9f8028b53e41c988763a9a))
- **io:** convert sync file operations to async in export and vault ([#162](https://github.com/hottim900/sparkle/issues/162)) ([f2d905b](https://github.com/hottim900/sparkle/commit/f2d905b2c5f05bcdaaedd7abfe510b83523daf57))
- **line-bot:** add missing origin field to handleTrack ([#171](https://github.com/hottim900/sparkle/issues/171)) ([09a13e8](https://github.com/hottim900/sparkle/commit/09a13e8ae09a098a94a94508fb5791e85cd6dfc8))
- **line-bot:** add user allowlist to restrict LINE Bot access ([#168](https://github.com/hottim900/sparkle/issues/168)) ([567e47c](https://github.com/hottim900/sparkle/commit/567e47ccee4a4de5c9cd9110573530d7dd582d71))
- make deploy resilient to non-main branch checkout ([#59](https://github.com/hottim900/sparkle/issues/59)) ([7f0ffaa](https://github.com/hottim900/sparkle/commit/7f0ffaa3dabe6ae050e355c7a79cb2abb73f9720))
- **mcp:** add min length validation to tag and alias schemas ([#241](https://github.com/hottim900/sparkle/issues/241)) ([5dc64f5](https://github.com/hottim900/sparkle/commit/5dc64f563cf56c96afc39d79378f914261ca289a))
- **mcp:** add strict() to all inputSchema to reject unknown parameters ([#166](https://github.com/hottim900/sparkle/issues/166)) ([40d73e4](https://github.com/hottim900/sparkle/commit/40d73e428021830de939a5c496608883fed6c970))
- **mcp:** address security review findings for HTTP transport ([#144](https://github.com/hottim900/sparkle/issues/144)) ([78e8792](https://github.com/hottim900/sparkle/commit/78e87923482093297ab6749b747f185b64ed5257))
- **mcp:** category tools — fix color validation, add reorder, rebuild dist ([#137](https://github.com/hottim900/sparkle/issues/137)) ([51bf3a7](https://github.com/hottim900/sparkle/commit/51bf3a74c745d8c74e720ff0be14720dae0a944f))
- **mcp:** resolve session leak with idle-aware LRU eviction ([#175](https://github.com/hottim900/sparkle/issues/175)) ([a862d1a](https://github.com/hottim900/sparkle/commit/a862d1a7cde055aa99182c579b54aff8a903c3f5))
- **mcp:** restore sparkle_list_notes in instructions and fix error casting ([#155](https://github.com/hottim900/sparkle/issues/155)) ([a01a04c](https://github.com/hottim900/sparkle/commit/a01a04cd94f7de8958e9d3cc18decb6205bb6328))
- **mcp:** return 404 instead of 409 for expired sessions ([#149](https://github.com/hottim900/sparkle/issues/149)) ([e687c8b](https://github.com/hottim900/sparkle/commit/e687c8bdd364a843259212d62a2d28d3b7d5d883))
- **mcp:** standardize HTTP server logging with pino ([#160](https://github.com/hottim900/sparkle/issues/160)) ([5981c21](https://github.com/hottim900/sparkle/commit/5981c21f066a0296e1de44b970b8179d9202e504))
- **mcp:** use /mcp path for MCP endpoint, add trust proxy and logging ([#145](https://github.com/hottim900/sparkle/issues/145)) ([ef89fb6](https://github.com/hottim900/sparkle/commit/ef89fb6b821d770e891afdc72827592b5e7bae1f))
- **mcp:** use JWT tokens for restart-safe auth with 1-year expiry ([#147](https://github.com/hottim900/sparkle/issues/147)) ([059aff8](https://github.com/hottim900/sparkle/commit/059aff8d3c2f84fcf78b80eff762dc0e7cf69b58))
- **mcp:** vault write frontmatter guard + update_note side-effect docs ([#167](https://github.com/hottim900/sparkle/issues/167)) ([d54861f](https://github.com/hottim900/sparkle/commit/d54861f6e9140632cba64258fc1f85425c060fbf))
- patch 4 high-ROI defects from systematic audit ([#63](https://github.com/hottim900/sparkle/issues/63)) ([fccaebc](https://github.com/hottim900/sparkle/commit/fccaebc7d939cb307b24ce13494c8d7ec10aaa90))
- preserve search params on navigate + remove type casts (DEF-017, TD-004) ([#113](https://github.com/hottim900/sparkle/issues/113)) ([7606f81](https://github.com/hottim900/sparkle/commit/7606f81e66f3a1a0bade4aa512dbc67486e530ab))
- prevent SW from caching CF Access pages after idle ([#88](https://github.com/hottim900/sparkle/issues/88)) ([9ef55ed](https://github.com/hottim900/sparkle/commit/9ef55ed71813f781f43c86e6c9b0fa63d91b8955))
- remove coverage check from pre-push hook ([#234](https://github.com/hottim900/sparkle/issues/234)) ([01309ce](https://github.com/hottim900/sparkle/commit/01309cea399575457a0322701c2ddcc156aa7a08))
- **security:** replace unsafe-inline with nonce-based CSP on share page ([#246](https://github.com/hottim900/sparkle/issues/246)) ([1cdcc3b](https://github.com/hottim900/sparkle/commit/1cdcc3b8fc14222316fa213b51b731bc5123ace3))
- **server:** authFailRateLimiter should only count 401/403, not 404s ([#201](https://github.com/hottim900/sparkle/issues/201)) ([f32a40c](https://github.com/hottim900/sparkle/commit/f32a40c4d8ebad31a4d90d4b136418e1ec12989e))
- **server:** eliminate redundant getItem calls and document internal settings ([#244](https://github.com/hottim900/sparkle/issues/244)) ([60b97e5](https://github.com/hottim900/sparkle/commit/60b97e58ad188ed09e6b539298d8d34e55a5f151))
- **server:** harden route validation and import schema consistency ([#243](https://github.com/hottim900/sparkle/issues/243)) ([7b7366e](https://github.com/hottim900/sparkle/commit/7b7366ef4632e1e9541337a0ef28ead9c1c9ef2b))
- **server:** harden security headers, IP extraction, and error messages ([#185](https://github.com/hottim900/sparkle/issues/185)) ([5da3f5b](https://github.com/hottim900/sparkle/commit/5da3f5bb4c18f0acc44a1acc978aa72c66c8089e))
- **server:** validate import type-status and reject empty tags/aliases ([#186](https://github.com/hottim900/sparkle/issues/186)) ([482c538](https://github.com/hottim900/sparkle/commit/482c538a12420f77b59fc498fce8c6df27cee7e9))
- **share:** allow inline scripts on public share pages via CSP ([#151](https://github.com/hottim900/sparkle/issues/151)) ([499b5a5](https://github.com/hottim900/sparkle/commit/499b5a5aeba3f71bd687fec067927eef03f6794a))
- strengthen schema validation (DEF-003~007) ([#75](https://github.com/hottim900/sparkle/issues/75)) ([abc9e70](https://github.com/hottim900/sparkle/commit/abc9e70f6d2dcc9f08ee0392add507dbcc9805a9))
- **ui:** prevent double-submit on category management mutations ([#157](https://github.com/hottim900/sparkle/issues/157)) ([7fabcb0](https://github.com/hottim900/sparkle/commit/7fabcb007cf329608e68a9cb7c4786da28a633ff))
- update local state when selecting category in ItemDetail ([#55](https://github.com/hottim900/sparkle/issues/55)) ([b3b4d45](https://github.com/hottim900/sparkle/commit/b3b4d45727efc95137bc72ec72e8111ca99bde93))
- use absolute paths in quality skill for worktree compatibility ([#67](https://github.com/hottim900/sparkle/issues/67)) ([4daafb9](https://github.com/hottim900/sparkle/commit/4daafb93ba347748930a939c789cdee3a7d9241f))
- use safe deploy pull and add worktree convention ([#60](https://github.com/hottim900/sparkle/issues/60)) ([85c35ff](https://github.com/hottim900/sparkle/commit/85c35ff3d8f8dd3bb473817f2f7a2bc1785b45d4))
- wire isBatchPending to disable batch action buttons ([#132](https://github.com/hottim900/sparkle/issues/132)) ([447b7f6](https://github.com/hottim900/sparkle/commit/447b7f6cc8c6855819028216b65938db47dfbe75))

### Performance Improvements

- field-aware query invalidation to reduce unnecessary refetch (TD-005) ([#133](https://github.com/hottim900/sparkle/issues/133)) ([229aa18](https://github.com/hottim900/sparkle/commit/229aa1886eb77b5e334c971c738cd9c68e5fbc7b))
- replace batch endpoint N+1 loops with bulk SQL queries (TD-003) ([#102](https://github.com/hottim900/sparkle/issues/102)) ([e22b6c8](https://github.com/hottim900/sparkle/commit/e22b6c82750289b3b5c0777745eaafe523f1973b))
- use enrich=false in LINE handlers + remove redundant getItem ([#117](https://github.com/hottim900/sparkle/issues/117)) ([72c580a](https://github.com/hottim900/sparkle/commit/72c580a2943e7e3599f8223ef5dfe37cb6981a4c))

## [1.2.3.0] - 2026-03-27

### Added

- Settings UI: Obsidian Daily Note section with enable toggle, folder/time/mode settings, and manual generate button
- `daily_note_enabled` setting: independent on/off control for daily note scheduler (separate from `obsidian_enabled`)
- Frontend API client `generateDailyNote()` with `DailyNoteGenerateResponse` type
- Two-layer disable logic: Obsidian disabled → entire section disabled; daily note disabled → fields disabled but generate still works
- 22 new tests: scheduler (1), settings unit (3), route validation (3), component tests (10), existing test updates (5)

### Changed

- Scheduler `checkAndGenerateDailyNote()` now checks `daily_note_enabled` before generating
- `DailyNoteSettings` interface includes `daily_note_enabled: boolean` field
- `SettingsResponse` type adds 4 optional fields for daily note settings
- `daily_note_mode` type tightened from `string` to `"subfolder" | "append"` in frontend types

## [1.2.2.0] - 2026-03-26

### Added

- LINE daily brief manual trigger endpoint (`POST /api/line-brief/send?date=YYYY-MM-DD`)
- Settings UI: LINE brief section with enable toggle, push time input, and manual send button
- Semantic date validation for line-brief endpoint (rejects invalid month/day)
- Frontend API client `sendLineBrief()` with `LineBriefSendResponse` type
- 28 new tests: route validation (10), settings validation (9), component tests (9)

### Changed

- `line_brief_enabled` defaults to `false` (opt-in) instead of `true` — prevents unintended push notifications on deploy
- Extract `saveSection()` helper in Settings to deduplicate 3 near-identical save handlers
- Skipped brief toast uses neutral `toast()` instead of misleading `toast.success()`

## [1.2.1.1] - 2026-03-26

### Added

- 45 unit tests for daily note generator (daily-note.ts, daily-note-scheduler.ts, routes/daily-note.ts)
- Coverage: daily-note-scheduler.ts 100%, routes/daily-note.ts 100%, daily-note.ts 90.7%/79.7%

### Changed

- Remove daily note files from vitest coverage exclusions — now count toward CI thresholds

## [1.2.1] - 2026-03-25

### Added

- Obsidian daily note generator — auto-generates daily notes from Sparkle activity at configurable time
- Subfolder mode writes to `{vault}/Daily/Sparkle/{date}.md`; append mode merges into existing daily notes
- Manual trigger API (`POST /api/daily-note/generate?date=YYYY-MM-DD`) for on-demand generation
- Server-side scheduler (60s interval) with dedup via `last_daily_note_date` setting
- Daily note settings: `obsidian_daily_folder`, `daily_note_time`, `daily_note_mode`
- Path traversal protection, wikilink/YAML injection safety, impossible date validation
- DB migration v15→16 for daily note settings defaults

## [1.2.0] - 2026-03-25

### Added

- Week data API endpoint (`GET /api/dashboard/week?start=YYYY-MM-DD`) for temporal bridge feature
- `getWeekData()` returns 7-day breakdown: todos by due date, notes by created/modified, historical overdue counts
- Date validation: requires valid YYYY-MM-DD Monday (ISO week start)
- Private items excluded from all week data queries
- Route validation tests for all error paths (missing param, invalid format, invalid date, non-Monday)
- gstack tooling support (`.gitignore`, `CLAUDE.md` section)

## [1.1.1](https://github.com/hottim900/sparkle/compare/v1.1.0...v1.1.1) (2026-03-03)

### Bug Fixes

- correct precacheAndRoute directoryIndex type (null → undefined) ([#47](https://github.com/hottim900/sparkle/issues/47)) ([439e029](https://github.com/hottim900/sparkle/commit/439e029a953980f00f8f4441d874eb232377fcec))
- resolve mobile web stuck in offline mode ([#44](https://github.com/hottim900/sparkle/issues/44)) ([a6ebbbd](https://github.com/hottim900/sparkle/commit/a6ebbbdf800aab34e793f34b540373064386bbf5))

## [1.1.0](https://github.com/hottim900/sparkle/compare/v1.0.0...v1.1.0) (2026-03-01)

### Features

- add offsite backup to secondary disk via restic copy ([584196d](https://github.com/hottim900/sparkle/commit/584196db5875ac4470c1a36a77de727211bbcbeb))
- honest offline UI — disable mutations when offline ([37443f9](https://github.com/hottim900/sparkle/commit/37443f93d6e21b77c3a5494c43fceb9dd448db17))
- offline indicator, CF Access JWT handling, mobile E2E tests ([#22](https://github.com/hottim900/sparkle/issues/22)) ([4216446](https://github.com/hottim900/sparkle/commit/42164464aa25c38d8d9516b5f7a8943317f3d548))
- project hardening — offsite backup, FK constraint, offline UI ([80721c8](https://github.com/hottim900/sparkle/commit/80721c8f65283fd88a29716faa0e6d34732ebfab))

### Bug Fixes

- add FK constraint on linked_note_id with ON DELETE SET NULL ([794178c](https://github.com/hottim900/sparkle/commit/794178c21a1dd8f8644e04893f77b056f4c26863))
- handle NULL timestamps in migration 11→12 ([b28200d](https://github.com/hottim900/sparkle/commit/b28200db348e2092096e2f5400bf6953023316d0))
- handle NULL timestamps in migration 11→12 to prevent crash ([65d94ec](https://github.com/hottim900/sparkle/commit/65d94ec7bfd0c71724c9a0755db385130f1762fc))
- schedule periodic cleanup of expired LINE Bot sessions ([070378e](https://github.com/hottim900/sparkle/commit/070378e4ae5466b196e3436d88a9ac685b4f63bc))
- schedule periodic cleanup of expired LINE Bot sessions ([626bd70](https://github.com/hottim900/sparkle/commit/626bd70bb0e13eec3000828315235d65de60817a))
- use explicit column names in migration 11→12 INSERT ([5120c50](https://github.com/hottim900/sparkle/commit/5120c50d2f41d637aba82d9980a55e5a3e195d33))
- use explicit column names in migration INSERT ([5b7d903](https://github.com/hottim900/sparkle/commit/5b7d903161282dac95ac1f3e265e316266918ac5))

## 1.0.0 (2026-03-01)

### Features

- add !done and !archive command parsing ([4e16cad](https://github.com/hottim900/sparkle/commit/4e16cad732f119236c8adc9eccb647fbc0549601))
- add !done, !archive, !priority, !untag LINE Bot commands ([febf2f2](https://github.com/hottim900/sparkle/commit/febf2f20e3c523938815024eb48cba6f391fc1fa))
- add !priority command parsing ([e7ec63f](https://github.com/hottim900/sparkle/commit/e7ec63f779a997a3475a345ee55103d1a1b14f9c))
- add !untag command parsing ([7bcc6f9](https://github.com/hottim900/sparkle/commit/7bcc6f98444abcf61d833c40acf00f1139369a08))
- add /api/stats and /api/stats/focus endpoints ([5cd829c](https://github.com/hottim900/sparkle/commit/5cd829c5f427a136980dd281f326c81671bbdcfe))
- add commitlint, E2E tests, MCP tests, and CI hardening ([9716dda](https://github.com/hottim900/sparkle/commit/9716ddabf7d6991ced4aae708f2b8547e3edb565))
- add dark mode support with next-themes ([962ebf0](https://github.com/hottim900/sparkle/commit/962ebf0ff9df83bbf53dcea46dcbe2bf5a5ffd41))
- add due date indicators, enhanced search, Docker support, UX polish, and API tests ([12c9887](https://github.com/hottim900/sparkle/commit/12c988723fcd7d74524a7883b577d502872b0e77))
- add frontend tests, split item-detail, and introduce AppContext ([a24d4ab](https://github.com/hottim900/sparkle/commit/a24d4ab1ac7656f6b77257806fc01d2dedcd4a11))
- add health endpoint, CSP header, structured logging, and test utils ([f0c8687](https://github.com/hottim900/sparkle/commit/f0c868734befbc0651c75689e7f0e0471c2f18e3))
- add LINE Bot edit and browse commands (!active, !list, !detail, !due, !tag) ([9293d49](https://github.com/hottim900/sparkle/commit/9293d491c83e131cc1f0dfef68cb1280af91b17d))
- add LINE Bot help command and quick reply buttons ([f723b61](https://github.com/hottim900/sparkle/commit/f723b61690239f2db50540e4e1394fdb21c6a9e3))
- add LINE Bot query commands (!find, !inbox, !today, !stats) ([b46a8f4](https://github.com/hottim900/sparkle/commit/b46a8f4ad300d97484bf2ce1614d82d19a1628a2))
- add LINE Bot scratch commands (!tmp, !scratch, !s, !delete, !upgrade) ([0671db3](https://github.com/hottim900/sparkle/commit/0671db3a888cd800aa031aa942251c76dee6bb88))
- add LINE message parser with prefix commands ([716a39c](https://github.com/hottim900/sparkle/commit/716a39c3542cce12bed79399b967c9a19b8135c3))
- add LINE webhook endpoint with signature verification ([0654b65](https://github.com/hottim900/sparkle/commit/0654b6515dfd717f4b544aee1fc168fbeeadeb8c))
- add linked todo — create tracking todo from note with !track command ([a692833](https://github.com/hottim900/sparkle/commit/a692833493f916668e23d6dbedc9a7be9a948d30))
- add local observability (enhanced health check + monitoring scripts) ([f3c33e1](https://github.com/hottim900/sparkle/commit/f3c33e17c8b740d30e5991d12c430232182ce89f))
- add markdown preview, data export/import, keyboard shortcuts, and batch operations ([193fe16](https://github.com/hottim900/sparkle/commit/193fe167dc485c2d63cc1ebf2673525def12fa83))
- add navigation stack for detail page back button ([f48d071](https://github.com/hottim900/sparkle/commit/f48d071368aed3d1c6f1494f98a3aa1c98cf000d))
- add notes/todos filter views and update app icons ([3288665](https://github.com/hottim900/sparkle/commit/32886655ebe3b25dbe1e752680a7692438893ef3))
- add optional HTTPS/TLS support to server ([46e212e](https://github.com/hottim900/sparkle/commit/46e212e4f5cace1afc29482cf4d333425fd60eb0))
- add public note sharing with token-based URLs ([8da0a15](https://github.com/hottim900/sparkle/commit/8da0a15b57ffffd7d99ad504bb2e8232fa7e4fb1))
- add PWA install prompt, desktop 3-column layout, tag autocomplete and source field ([0a0a875](https://github.com/hottim900/sparkle/commit/0a0a875d246e0b23f83c244397727a076c2aabab))
- add review dashboard with stats, focus, and inbox health ([7db5039](https://github.com/hottim900/sparkle/commit/7db5039f3bf9fb61cae2c82adc7c70e03f8f8bfa))
- add scratch count to dashboard and update CLAUDE.md ([054e4e5](https://github.com/hottim900/sparkle/commit/054e4e5c35fa096b0c3e2538d656c8382092e2db))
- add scratch routing, filtering, and batch actions to frontend ([8f14243](https://github.com/hottim900/sparkle/commit/8f14243a7fffc0dce3754c426481679ada79d0f1))
- add scratch type conversion mapping and field clearing ([ecb6366](https://github.com/hottim900/sparkle/commit/ecb636647ffdca9601fdd31f9c10f5c57bb89242))
- add scratch type to frontend types and navigation ([257da6f](https://github.com/hottim900/sparkle/commit/257da6f0be30b4a624801c55384a9f72042d9907))
- add scratch type with draft status to type system ([660cc3f](https://github.com/hottim900/sparkle/commit/660cc3ff63981013762718a1f58215b9897605b7))
- add scratch UI to item card, detail editor, and quick capture ([e0ae6e8](https://github.com/hottim900/sparkle/commit/e0ae6e8ea4f6740dfedf0c49ec85b21468261979))
- add scratch_count to stats and DB migration 9-&gt;10 ([f0303ec](https://github.com/hottim900/sparkle/commit/f0303ecdbaf20fbaca5c795c525928484911a130))
- add Sentry error tracking, CI E2E tests, and auto-deploy workflow ([35484c3](https://github.com/hottim900/sparkle/commit/35484c338ddaef1c33376455f7b384f7546b6a3d))
- add share visibility indicators to item cards and detail page ([561b50b](https://github.com/hottim900/sparkle/commit/561b50b48b329f09bbd9beb40517a5642f5552d7))
- add sort functionality for item listing ([043096b](https://github.com/hottim900/sparkle/commit/043096be260b6e92fa9874168beb08ec9bbda76d))
- add stats and focus API client types and functions ([1b0936e](https://github.com/hottim900/sparkle/commit/1b0936e718e920469ae791b641bf9cdf9f1ef57c))
- add type indicator bar to item detail page ([616da18](https://github.com/hottim900/sparkle/commit/616da18d1c1de7384268f6e39735ac86ba7d9e49))
- add type segmented control to quick capture ([2655361](https://github.com/hottim900/sparkle/commit/2655361e388295174e71899958058d5a082ff196))
- default todo list sort to due date (近→遠) ([b215ffc](https://github.com/hottim900/sparkle/commit/b215ffc871567fb20d618cc103704861a089902e))
- enhance triage mode with type toggle, tags, due dates ([f66b3e4](https://github.com/hottim900/sparkle/commit/f66b3e4d81ffef3f2b1d96ba74150613f96e3d49))
- implement full personal TODO list app (Hono + Vite + React) ([ceb8058](https://github.com/hottim900/sparkle/commit/ceb8058a8fa25e59455313b2c20639c0551e12e0))
- implement Obsidian integration — Zettelkasten status redesign, export, and frontend restructure ([da6b95c](https://github.com/hottim900/sparkle/commit/da6b95ceb502eaf83e2bdd4a5244b8395f1f63fb))
- linked items consistency + card cleanup ([e5019d8](https://github.com/hottim900/sparkle/commit/e5019d82d1ba877e736d702eec09ab9a78d645a5))
- make due date todo-only — notes no longer support due dates ([25bb71f](https://github.com/hottim900/sparkle/commit/25bb71fbb0bbfc24e66c6725f1a4b1899b933e4b))
- **mcp:** add entry point with stdio transport ([552f7af](https://github.com/hottim900/sparkle/commit/552f7af5ad666f2fbcfd6ca9611e4c058b7e542b))
- **mcp:** add knowledge layer with instructions, resources, and guide tool ([d6dc26e](https://github.com/hottim900/sparkle/commit/d6dc26e0e4a0643e67876314cdaa52aa4390ab9f))
- **mcp:** add markdown formatting helpers ([6e2dcb5](https://github.com/hottim900/sparkle/commit/6e2dcb59a44680e29e20fa90adc81926a272f7f3))
- **mcp:** add partial content update (find-and-replace) to sparkle_update_note ([5adcdbd](https://github.com/hottim900/sparkle/commit/5adcdbd66714822d8a86e091a777ed31db244ec7))
- **mcp:** add read-only tools (search, get, list, stats, tags) ([7e3935b](https://github.com/hottim900/sparkle/commit/7e3935b9b0448b09233922f6cf05a8ff88cfa955))
- **mcp:** add Sparkle API types and REST client ([c4ec1a9](https://github.com/hottim900/sparkle/commit/c4ec1a90384444972998f35a55b492f0a10b2201))
- **mcp:** add workflow tools (advance, export) ([7be345b](https://github.com/hottim900/sparkle/commit/7be345bcd9316ed7d69f94d99c9a8c32a7ffb855))
- **mcp:** add write tools (create, update) ([c8f0bbd](https://github.com/hottim900/sparkle/commit/c8f0bbdfd473c6fb95a7d7f8f57557961159370f))
- **mcp:** expand create/update tools with todo, priority, due, linked_note_id ([f75ffd5](https://github.com/hottim900/sparkle/commit/f75ffd52ceb121dbde6b08a2f173d9a49ee1422f))
- **mcp:** finalize sparkle-mcp-server with docs and config ([ce5b929](https://github.com/hottim900/sparkle/commit/ce5b929f1e44de9f144bb2cc2c8ce1f3a1cc3835))
- **mcp:** scaffold sparkle-mcp-server sub-project ([c3f8601](https://github.com/hottim900/sparkle/commit/c3f8601d478bf84946d8580ce1191fbd65cf8a87))
- migrate from VPN-only to full Cloudflare Tunnel + CF Access ([4ab1ee7](https://github.com/hottim900/sparkle/commit/4ab1ee780df649a9c2e5eb4250f3e1d55d5c5240))
- move Obsidian config from .env to Web UI settings page ([d7e3fde](https://github.com/hottim900/sparkle/commit/d7e3fde4d14c87a07b3990f1c0cf04520a93731c))
- pass currentView to QuickCapture for type-aware defaults ([e47efb7](https://github.com/hottim900/sparkle/commit/e47efb70cc8f4036b14cc0d87aa8c26cb3fca1c9))
- Phase 2 — deployment, dashboard, LINE Bot integration ([3ed7614](https://github.com/hottim900/sparkle/commit/3ed76144cc1e67012b29632e5fc13c730e4147e6))
- replace hand-written markdown renderer with react-markdown + remark-gfm ([d03d178](https://github.com/hottim900/sparkle/commit/d03d1782db9ce2056f3d1b503d8ea23a39930a5a))
- restrict port 3000 to localhost and WireGuard subnet via iptables ([becc296](https://github.com/hottim900/sparkle/commit/becc296f54baf3110ea1633a9e572d6309f2f37a))
- update MCP server tools to support scratch type ([0e4d72d](https://github.com/hottim900/sparkle/commit/0e4d72d746c6bdcf03e0dfd866803b5a564701da))
- UX improvements — sort by modified, linked note indicator, tag keyboard nav ([38ce624](https://github.com/hottim900/sparkle/commit/38ce624411eada6c4a053fcd510768aef62a540d))

### Bug Fixes

- add "notes" view type to match bottom nav "筆記" label ([fcee32e](https://github.com/hottim900/sparkle/commit/fcee32ee68fb48022f01a83f22b975c5f482a377))
- add AUTH_TOKEN startup check and improve docker-compose ([d76651f](https://github.com/hottim900/sparkle/commit/d76651f9ecacee22be99f33d9314b0157a038261))
- add error boundaries, Vary header, and fix React hook deps ([f0cf3c0](https://github.com/hottim900/sparkle/commit/f0cf3c055d8cf0b96003923a4a935c8a96ad2ad4))
- add mobile-friendly tag input with add button and IME support ([#17](https://github.com/hottim900/sparkle/issues/17)) ([395f6dc](https://github.com/hottim900/sparkle/commit/395f6dc058961a8dcf9b23eb9e09e3b4640d77af))
- address cleanup review feedback ([7f09d76](https://github.com/hottim900/sparkle/commit/7f09d763b64c2efd5addb40628e03a710beddea4))
- address P2 medium-risk deployment vulnerabilities ([3a2c2f4](https://github.com/hottim900/sparkle/commit/3a2c2f4c3994fde0239532d865d979ed93230357))
- align todo linked note display with note linked todo card style ([681084e](https://github.com/hottim900/sparkle/commit/681084ef82d37ecf51592fda3e45b75bcd6da26b))
- allow WSL2 host network in iptables to fix VPN access ([65bded2](https://github.com/hottim900/sparkle/commit/65bded26d72a145f4afe6105d466d613db35d486))
- auto-logout on 401 response to prevent stuck invalid token state ([775d2a8](https://github.com/hottim900/sparkle/commit/775d2a8877659e14ebf0b6711b2b2d2a94bcc6b2))
- correct anchor links in README.md ([15afadd](https://github.com/hottim900/sparkle/commit/15afadd573a0aba71b45093d0c930b21981b7a00))
- delete only synced items from offline queue instead of clearing all ([47fe950](https://github.com/hottim900/sparkle/commit/47fe95034d9395ebf263691c15290ab040f0ffb7))
- enrich API responses with computed fields and add missing MCP types ([2be13d7](https://github.com/hottim900/sparkle/commit/2be13d75d93239a1b83b204780104117a3b302f0))
- escape FTS5 search queries to prevent 500 on special characters ([a793151](https://github.com/hottim900/sparkle/commit/a793151656fec0a177ee9fb31e87bd7832198046))
- fix LINE reply failures by adding error logging and fixing empty quick reply text ([b10fee6](https://github.com/hottim900/sparkle/commit/b10fee6477c335f4966027e33b4bf5bba470da2d))
- guard against invalid status values in listItems API client ([26c0d16](https://github.com/hottim900/sparkle/commit/26c0d166d85312ae26221af88b4fe708e8e93a3e))
- handle nvm in non-interactive login shell for node detection ([3f7f8c3](https://github.com/hottim900/sparkle/commit/3f7f8c3f565e61f0549ce4ec4fa04e7774923fdd))
- harden deployment security (P0+P1 audit remediation) ([a9f09a8](https://github.com/hottim900/sparkle/commit/a9f09a89492f92b9e382f3b71217d67a12224524))
- harden deployment security and resilience ([c540856](https://github.com/hottim900/sparkle/commit/c5408565f7ed97ce02c9945f8cc9e65a231780bf))
- improve network resilience with retry, caching, and SW updates ([#16](https://github.com/hottim900/sparkle/issues/16)) ([4629617](https://github.com/hottim900/sparkle/commit/4629617e6db5281f360f8670d830025ae8770a27))
- make install-services.sh interactive and conditional ([14e0563](https://github.com/hottim900/sparkle/commit/14e0563af937b47d0f5b5163a7182721789badd4))
- move tsx to dependencies and auto-create data directory ([d7209bd](https://github.com/hottim900/sparkle/commit/d7209bd31c4bb0b5dc788d5cd7eb8007b2ff2b3d))
- prevent long URLs from overflowing item detail layout ([e8eb2f7](https://github.com/hottim900/sparkle/commit/e8eb2f775c556e7894e62307bd587c5628c81612))
- prevent SW controllerchange reload on first install ([#18](https://github.com/hottim900/sparkle/issues/18)) ([72ed9e4](https://github.com/hottim900/sparkle/commit/72ed9e40600130c57a4d307b7e4dfe3420345c39))
- quality consolidation — 7 issues from code review ([f2d4dfc](https://github.com/hottim900/sparkle/commit/f2d4dfca847f66fc217886e40868926e8fa0545f))
- refresh sidebar tags when items are updated ([6e7b6af](https://github.com/hottim900/sparkle/commit/6e7b6afbbff81df70c561fdec75aca685ee637f8))
- relax rate limit and increase debounce for better typing UX ([84057c4](https://github.com/hottim900/sparkle/commit/84057c42ffb88a0d6f4f33af45c1749bbcf91aee))
- render Dashboard full-width instead of inside narrow list panel ([4267d18](https://github.com/hottim900/sparkle/commit/4267d183aa2a520556ea56a33609efcf48e0880f))
- replace native select with shadcn Select for sort dropdown ([4bf3904](https://github.com/hottim900/sparkle/commit/4bf3904424b6e78285659e50d9ce271c0554fd82))
- resolve all critical deployment vulnerabilities ([d2a8c68](https://github.com/hottim900/sparkle/commit/d2a8c68072d01923839f4f6a5b54652965ae4415))
- resolve all server TypeScript strict mode errors ([e3a0fba](https://github.com/hottim900/sparkle/commit/e3a0fba791397d6326f2e74201d2f3edc422bacb))
- resolve CI type-check failures ([bba69ac](https://github.com/hottim900/sparkle/commit/bba69aca876057d83cccc3ab476ed55c560b874c))
- resolve code review findings for share indicators ([570f65b](https://github.com/hottim900/sparkle/commit/570f65b535f325d8ee981b02e3b67176adf3135b))
- restrict !done and !due commands to todo-only in LINE Bot ([b535063](https://github.com/hottim900/sparkle/commit/b535063429ba6e782e3d4dd8377173647206c4e7))
- revert eslint 10 upgrade (ecosystem not ready) ([#20](https://github.com/hottim900/sparkle/issues/20)) ([20591ee](https://github.com/hottim900/sparkle/commit/20591ee03d1de4e6b09ae5ee28603965aceb57ed))
- switch FTS5 to trigram tokenizer for Chinese search support ([1682064](https://github.com/hottim900/sparkle/commit/1682064179c1d4aaee1bdeb30572a3d53e5a5313))
- update all https://localhost:3000 references to http after TLS removal ([0191810](https://github.com/hottim900/sparkle/commit/01918105fcf49a71877693aee471257172d42d7c))
- update E2E tag test locator for new TagInput DOM structure ([#19](https://github.com/hottim900/sparkle/issues/19)) ([aeb664e](https://github.com/hottim900/sparkle/commit/aeb664ee82bacf280c3e59f785dfbc81821652f9))
- use getRequestListener for HTTPS compatibility with Hono ([7166b84](https://github.com/hottim900/sparkle/commit/7166b84fdf0293f42dd6018c0904f7987e3fde18))
- use local timezone consistently in stats date calculations ([3e5c3d9](https://github.com/hottim900/sparkle/commit/3e5c3d9c355c869d42486b1371558f06388eface))
- use resolvedTheme for correct dark/light mode button label ([f1c27c5](https://github.com/hottim900/sparkle/commit/f1c27c5ccc6dba149260834d74db6ca1bb788999))

### Performance Improvements

- add compression, code splitting, cache headers, and remove loopback TLS ([647f8cb](https://github.com/hottim900/sparkle/commit/647f8cb48148d69ebfe494b8e2656b788c44d54d))
- replace new URL(c.req.url).pathname with c.req.path (M5) ([c6c3741](https://github.com/hottim900/sparkle/commit/c6c37416863b8b22d3bb7627fcca53562222c43d))
