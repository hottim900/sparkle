import { findAndReplace } from "mdast-util-find-and-replace";

// Mirrors src/lib/wikilink.ts conservative shape: title trimmed, no newlines,
// 1-256 chars, no nested `[[`. Alias optional, trimmed, non-empty.
// findAndReplace already restricts to text nodes — code / inlineCode are
// skipped automatically (ENG-26), no manual scope-check needed.
const WIKILINK_RE = /\[\[([^[\]\n|]{1,256})(?:\|([^[\]\n|]{1,256}))?\]\]/g;

// Legacy 筆記（xxxxxxxx）short-id reference. 4-8 hex chars. Indexed as a
// distinct visual chip so the user notices it's deprecated and rewrites
// to [[Title]] when convenient. PR 4 ships a one-shot backfill migration.
const LEGACY_HEX_RE = /筆記（([0-9a-f]{4,8})）/g;

/**
 * remark plugin: rewrite `[[Title]]` and legacy `筆記（xxxx）` in text nodes
 * to custom HTML element nodes the React renderer picks up via the
 * `components` map in markdown-preview.
 *
 * - `[[Title]]` → `<sparkle-wikilink title="Title" />`
 * - `[[Title|alias]]` → `<sparkle-wikilink title="Title" alias="alias" />`
 * - `筆記（abcdef12）` → `<sparkle-legacy-ref shortid="abcdef12" />`
 *
 * Match titles trimmed; an over-trimmed result that becomes empty is left
 * verbatim in the source (the lookahead requires `{1,256}` of non-special
 * chars, so the title cannot be empty post-match).
 */
export function remarkWikilink() {
  return (tree: unknown) => {
    findAndReplace(tree as Parameters<typeof findAndReplace>[0], [
      [
        WIKILINK_RE,
        (_full: string, rawTitle: string, rawAlias?: string) => {
          const title = rawTitle.trim();
          if (title.length === 0) return false;
          const aliasTrimmed = rawAlias?.trim();
          const alias = aliasTrimmed && aliasTrimmed.length > 0 ? aliasTrimmed : undefined;
          return {
            type: "text" as const,
            value: "",
            data: {
              hName: "sparkle-wikilink",
              hProperties: alias ? { title, alias } : { title },
            },
          };
        },
      ],
      [
        LEGACY_HEX_RE,
        (_full: string, shortid: string) => ({
          type: "text" as const,
          value: "",
          data: {
            hName: "sparkle-legacy-ref",
            hProperties: { shortid },
          },
        }),
      ],
    ]);
  };
}
