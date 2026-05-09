import { createHash } from "node:crypto";

/**
 * Compute the canonical revision token for a note's content.
 *
 * Always lowercase 64-character hex (sha256). The MCP edit protocol pins every
 * sparkle_edit_note call against this revision; mismatches surface as
 * REVISION_MISMATCH so the LLM re-fetches fresh handles.
 */
export function computeRevision(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Regex used by zod to validate caller-supplied revision tokens. */
export const REVISION_REGEX = /^[a-f0-9]{64}$/;
