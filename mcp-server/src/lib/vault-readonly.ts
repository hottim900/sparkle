import { getVaultPathBySparkleId } from "../client.js";
import { logger } from "../logger.js";

/**
 * Build the canonical VAULT_READONLY response for MCP tools that try to
 * mutate a vault-origin item. Mirrors `server/lib/vault-errors.ts`
 * `vaultReadonlyPayload` so the LLM-facing payload is uniform across
 * REST, MCP, and LINE entry points.
 *
 * Pre-v25 there was an `export_path` snapshot fallback; that column was
 * dropped, so `vault_path_source` only ever reads `"lookup"` (live) or
 * `null` (file not yet indexed by the 5-min scanner, or already released).
 *
 * The `getVaultPathBySparkleId` helper catches HTTP 404 by message regex,
 * but any other failure (server-supplied "Not found" with no 404 token,
 * 5xx, network blip) would otherwise escape and the caller would surface a
 * generic `formatToolError` message instead of the canonical VAULT_READONLY
 * recovery payload. Treat any lookup failure as "path not yet indexed" —
 * the agent's recovery path is identical (retry after 5 min).
 */
export async function vaultReadonlyResponse(
  sparkleId: string,
  errorMessage: string,
  errorMessageEn: string,
): Promise<{ isError: true; content: { type: "text"; text: string }[] }> {
  let vault_path: string | null = null;
  try {
    const lookup = await getVaultPathBySparkleId(sparkleId);
    vault_path = lookup?.path ?? null;
  } catch (err) {
    logger.warn(
      { sparkleId, err: err instanceof Error ? err.message : String(err) },
      "vault path reverse-lookup failed; surfacing VAULT_READONLY with vault_path=null",
    );
  }
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          code: "VAULT_READONLY",
          error: errorMessage,
          error_en: errorMessageEn,
          vault_path,
          vault_path_source: vault_path ? "lookup" : null,
          hint_endpoint: "DELETE /api/items/:id/vault-stub",
          hint_tool_by_id: "sparkle_write_obsidian",
          hint_tool_by_path: "sparkle_write_obsidian_by_path",
          doc_url: "sparkle://docs/data-model#vault-items",
        }),
      },
    ],
  };
}
