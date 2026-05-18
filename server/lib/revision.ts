import { createHash } from "node:crypto";

/**
 * Compute the canonical revision token for a note's content.
 *
 * Always lowercase 64-character hex (sha256). Mirrors
 * `mcp-server/src/edit/revision.ts` so the MCP edit_note v2 protocol and
 * the REST PATCH compare-and-swap share one wire format.
 *
 * Notes whose content has never been set persist as `null`/`undefined` in
 * the schema; treat that as the empty string so a freshly-created item has
 * a stable revision token from the first PATCH.
 */
export function computeRevision(content: string | null | undefined): string {
  return createHash("sha256")
    .update(content ?? "", "utf8")
    .digest("hex");
}

/** Regex used by zod to validate caller-supplied revision tokens. */
export const REVISION_REGEX = /^[a-f0-9]{64}$/;

/**
 * Thrown by `updateItem` when the caller supplied a revision token that no
 * longer matches the stored content. The route layer maps this to HTTP 412
 * with the current revision + content so the client (or rename engine, or
 * MCP wrapper) can reconcile.
 */
export class RevisionMismatchError extends Error {
  readonly code = "REVISION_MISMATCH" as const;
  constructor(
    public readonly itemId: string,
    public readonly expected: string,
    public readonly actual: string,
    public readonly currentContent: string,
  ) {
    super(
      `Revision mismatch for item ${itemId}: caller expected ${expected.slice(0, 8)}…, actual ${actual.slice(0, 8)}…. Re-fetch and retry.`,
    );
    this.name = "RevisionMismatchError";
  }
}
