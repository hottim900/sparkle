import { SparkleApiError } from "./client.js";

/**
 * Format a thrown error for an MCP tool response. When the underlying error
 * is a `SparkleApiError` with a structured `code` field, surface the full
 * payload as JSON so the agent can branch on it programmatically (e.g.
 * `code === "TITLE_COLLISION"` → suggest a different title).
 *
 * Without a structured code, fall back to a prose message — but always
 * include the HTTP status so the agent can distinguish 4xx from 5xx.
 */
export function formatToolError(error: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  if (error instanceof SparkleApiError) {
    if (error.code !== null) {
      // Structured error — emit JSON so agents can parse without regex.
      const body = {
        error: true,
        status: error.status,
        code: error.code,
        message: error.message,
        ...(error.payload ?? {}),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: `Error (HTTP ${error.status}): ${error.message}` }],
      isError: true,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}
