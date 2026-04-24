/**
 * VAULT_READONLY error shape returned when callers try to mutate a vault-origin
 * item. Routes (DELETE/PATCH), MCP tools (sparkle_update_note/pause/resume/
 * advance_note), and LINE command handlers all converge on this payload so AI
 * agents get a consistent signal + hint for recovery.
 *
 * `doc_url` is an MCP resource URI (sparkle://docs/...), NOT a web path —
 * there is no /docs/data-model route on the web server.
 */

export const VAULT_READONLY = "VAULT_READONLY" as const;

export type VaultReadonlyCode = typeof VAULT_READONLY;

export interface VaultReadonlyPayload {
  error: string;
  error_en: string;
  code: VaultReadonlyCode;
  vault_path: string | null;
  hint_endpoint: string;
  hint_tool_by_id: string;
  hint_tool_by_path: string;
  doc_url: string;
}

export function vaultReadonlyPayload(
  vault_path: string | null,
  overrides: Partial<VaultReadonlyPayload> = {},
): VaultReadonlyPayload {
  return {
    error: "此項目為 vault-origin，Sparkle DB 僅持 metadata；內容以 vault 為準",
    error_en:
      "This item is vault-origin. Sparkle only stores metadata; vault file is the content source of truth.",
    code: VAULT_READONLY,
    vault_path,
    hint_endpoint: "DELETE /api/items/:id/vault-stub",
    hint_tool_by_id: "sparkle_write_obsidian",
    hint_tool_by_path: "sparkle_write_obsidian_by_path",
    doc_url: "sparkle://docs/data-model#vault-items",
    ...overrides,
  };
}
