# Wikilink Cross-References — Spec (Pre-PR0d/e)

Status: **Locked** — implementation reference for the wikilink-first feature (PR 1 onwards).
Source design: `~/.gstack/projects/hottim900-sparkle/tim-main-design-20260518-022222.md`.

This document closes the two open scope questions surfaced during autoplan:
**Pre-PR0d** (daily-note carve-out) and **Pre-PR0e** (title uniqueness scope).
PR 1's resolver, PR 3's rename engine, and PR 4's backfill all read this doc
before touching code.

---

## Pre-PR0d — Daily-note carve-out

### The conflict

`server/lib/daily-note.ts:204,213,256,265` writes wikilinks to vault daily-note
`.md` files using the format `[[<Title>|sparkle-<shortId>]]`. The alias portion
(`|sparkle-<shortId>`) is a stable identifier that survives title renames — that's
why it's there.

The wikilink-first design (PR 3) introduces a title rename engine that rewrites
references to a renamed item. Two questions:

1. Does the rename engine need to rewrite vault daily-notes too?
2. If not, what happens to existing daily-notes that reference an item whose
   title changes after the daily-note was generated?

### Decision: **Option A — active-only rewrite scope**

The rename engine rewrites references in `items_active` content only. It does
**NOT** touch vault `.md` files, including daily-notes.

**Rationale.**

- **Vault is SSOT (post-v25).** `docs/migration-v25.md` lays the rule: vault
  `.md` is the content authority for exported notes. Sparkle stops mutating
  vault files except through explicit user-driven flows (`sparkle_write_obsidian`,
  daily-note generation, export). Rename engine mutating vault would re-open
  the very mismatch class v25 closed.
- **Daily-notes alias the short ID.** Existing daily-notes use
  `[[Old Title|sparkle-abc12345]]`. After a rename to "New Title":
  - **Obsidian-side:** the link target (`Old Title`) no longer resolves to any
    `.md` filename. Obsidian renders it as an unresolved link (purple) but the
    `sparkle-abc12345` alias remains a stable handle a human can grep.
  - **Functionally:** clicking the link in Obsidian fails to navigate, but the
    history record (the daily-note's narrative of "today I touched X") stays
    legible.
- **Cost of doing the rewrite is high.** Vault rewrite would mean: scan every
  `.md` for the renamed item's short-id alias, parse markdown, surgically
  rewrite the title portion of every matching wikilink, write the file back —
  while contending with the vault scanner's 5-min cycle, with Obsidian's
  own open-file lock, and with users editing the daily-note by hand.
- **Cost of NOT doing the rewrite is low.** Sparkle is the front-end for
  capture and active triage; long-term archival lives in Obsidian. Obsidian
  itself has a stronger rename engine (path-aware, file-system-level). Users
  who rename a permanent note in Sparkle and care about vault-side cleanup
  should run Obsidian's "rename + update all links" against the exported file.

### What the rename engine **does** do for daily-notes

Nothing direct. Forward-derived correctness:

- **New daily-notes** generated after the rename use the current title, because
  `daily-note.ts` reads `items_active.title` at generation time.
- **Active items in `items_active.content`** that cite the renamed item via
  `[[Title]]` get rewritten in-place — same engine, same transaction.
- **Vault daily-notes (already-generated)** retain the old title in the display
  position; the `sparkle-<shortId>` alias keeps the row identity intact for
  any reader who knows to look at the alias.

### What PR 3's rename UI must communicate

When the user (or Claude via MCP) renames a title, the dialog/response must
distinguish Sparkle scope from Obsidian scope. Suggested copy (per DES-5):

> "30 Sparkle references will update. Vault daily-notes will not be changed —
> Obsidian's rename feature is the right tool for that."

Implementation reference: PR 3 `src/components/rename-references-dialog.tsx`
N>0 inline list and the N>20 "在背景執行" summary both carry this copy.

### Where this is enforced in code

| Surface                    | Behavior                                                             | File                                                         |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| Rename engine source range | Active items only — query `reference_index` joined to `items_active` | PR 3 `server/lib/rename-engine.ts`                           |
| Daily-note generation      | Reads current `items_active.title` per row (already correct)         | `server/lib/daily-note.ts:204,213,256,265`                   |
| Vault `.md` mutation       | None — no path                                                       | PR 3 `server/lib/rename-engine.ts` (negative assertion test) |
| Test coverage              | E2E asserts vault `.md` mtime unchanged after rename                 | PR 3 `e2e/rename-flow.spec.ts`                               |

---

## Pre-PR0e — Title uniqueness scope

### The conflict

PR 1 introduces a title↔id resolver that reads `[[Title]]` and returns the
matching item's UUID. For this to be deterministic the system needs a uniqueness
contract. But:

- `items_active` already contains duplicates today
  (`"網路備忘錄-231-25-7-7"` ×2, `"未命名"` ×2 — verified via live SQLite query
  in autoplan re-run, line 745 of the design doc).
- `items_vault` titles come from vault `.md` filenames the user controls
  independently — Sparkle never had a chance to enforce uniqueness there.
- `vault_files.title` is set by the vault scanner from `.md` content or
  filename; Sparkle has no way to prevent two unrelated `.md` files from
  carrying the same H1.
- A naïve "CREATE UNIQUE INDEX on items_active(title)" migration would halt
  startup (v25 pattern) until the user manually de-duplicates 2 prod rows —
  unacceptable.

### Decision: **Application-layer enforce, active-only, with allowlist**

Three rules:

1. **Scope = `items_active` only.** Uniqueness is checked at write paths
   that create or rename a row in `items_active`. Vault titles are NOT in
   scope — the resolver's cross-table lookup (PR 1) tolerates collisions
   by returning `null` (the active-priority rule still applies for the
   non-collision path).

2. **Enforcement layer = application (not DB constraint).** No
   `CREATE UNIQUE INDEX` migration. Pre-write check at:
   - `createItem` (`server/lib/items.ts`)
   - `updateItem` when `input.title` is present
   - LINE Bot capture handlers
   - Import handler (loop check + per-row reject)
     The check runs inside a `BEGIN IMMEDIATE` so two concurrent creators
     can't both pass and both insert (ENG-7).

3. **Allowlist for derivation defaults.** The check exempts:
   - **`"未命名"`** — the literal Traditional Chinese for "Untitled",
     used as the fallback default for fleeting items that lack a derived
     first-line title (`src/routes/private.tsx:912` is the current site).
     Two `"未命名"` rows exist in prod today; blocking new fleeting
     captures because someone else has an unnamed scratch would defeat
     the entire quick-capture flow. The resolver returns `null` for
     `[[未命名]]` — treat that link as unresolvable.
   - **(Optional, evaluate in PR 1)** Future date-derived placeholders
     like `fleeting-2026-05-18-1422`. Out of scope until they exist.

### Normalization rules

Two titles are "the same" for uniqueness purposes when:

- **Unicode NFC normalization** matches (`"é"` U+00E9 == `"é"` U+0065 U+0301).
- **Trim** matches (`"Foo"` == `" Foo "`).
- **Case-insensitive ASCII compare**: `"Foo"` == `"foo"`.
- **CJK case-folding is intentionally not applied** — `"FOO"` and `"foo"`
  collide; `"全形ＡＢＣ"` and `"半形ABC"` do NOT collide (the user may
  intentionally distinguish them). This matches Obsidian's `[[wikilink]]`
  resolution behavior, which is case-sensitive on Linux/macOS.

Server-side: implement as `normalizeTitleForUniqueness(s) = s.trim().normalize("NFC").toLowerCase()` (Latin lowercase only — CJK is already canonical under NFC).

### Resolver behavior in the collision case

When `[[Title]]` matches > 1 active row (because the allowlist permitted
multiple `"未命名"` rows), the resolver returns `null`. Frontend renders the
link as **unresolved (purple)** — same as a typo or deleted target. This
matches Obsidian's behavior for ambiguous wikilinks in multi-folder vaults.

### What PR 1 must build

| Capability                                         | File                                                    |
| -------------------------------------------------- | ------------------------------------------------------- |
| `normalizeTitleForUniqueness(s)`                   | `server/lib/wikilink.ts`                                |
| `isTitleAvailable(db, normalizedTitle, exceptId?)` | `server/lib/wikilink.ts`                                |
| Pre-create check in `createItem`                   | `server/lib/items.ts`                                   |
| Pre-rename check in `updateItem`                   | `server/lib/items.ts`                                   |
| `"未命名"` allowlist constant                      | `server/lib/wikilink.ts` (`TITLE_UNIQUENESS_ALLOWLIST`) |
| `BEGIN IMMEDIATE` wrap around check+insert         | `server/lib/items.ts`                                   |
| Structured error code `TITLE_COLLISION`            | `server/lib/errors.ts`                                  |
| Admin reconcile UI for existing duplicates         | PR 3 `src/routes/admin-title-collisions.tsx`            |

### Migration plan

No DB migration in PR 1. The 2 existing duplicates remain in place. PR 3
ships `/admin/title-collisions` which lists them and offers per-row rename
or merge actions. The allowlist for `"未命名"` is durable — it stays in the
codebase, with a comment pointing here.

### Test coverage required (PR 1)

- Two concurrent `createItem` calls with same title both racing the
  `BEGIN IMMEDIATE` → exactly one succeeds (ENG-7).
- `createItem({ title: "未命名" })` succeeds even when another `"未命名"`
  exists in the DB.
- `updateItem(id, { title: "X" })` where another row has title "X" →
  `TITLE_COLLISION` (unless the other row is in the allowlist).
- NFC normalization: creating `"é́"` (decomposed) after `"é"` (composed)
  exists → `TITLE_COLLISION`.
- Case-insensitive ASCII: creating `"Foo"` after `"foo"` exists →
  `TITLE_COLLISION`.
- Case-sensitive CJK / full-width: creating `"全形ＡＢＣ"` after `"半形ABC"`
  exists → succeeds (no collision).
- Resolver for `[[未命名]]` returns `null` (ambiguous in active table).

---

## Cross-references

- Original design doc: `~/.gstack/projects/hottim900-sparkle/tim-main-design-20260518-022222.md`
- Eng review test plan: `~/.gstack/projects/hottim900-sparkle/tim-main-eng-review-test-plan-20260518-103900.md`
- Migration v25 vault-SSOT baseline: `docs/migration-v25.md`
- MCP edit_note v2 revision protocol: `mcp-server/src/edit/revision.ts` (shared wire format)
- Pre-PR0a (FTS trigger narrow): merged in v1.5.0.2, PR #333
- Pre-PR0b (CAS revision guard): merged in v1.5.0.3, PR #335
