import { SparkleApiError } from "./client.js";

export function formatToolError(error: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  if (error instanceof SparkleApiError) {
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
