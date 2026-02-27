import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DOCS } from "./content.js";

export function registerDocResources(server: McpServer): void {
  for (const [topic, doc] of Object.entries(DOCS)) {
    server.registerResource(
      `sparkle-docs-${topic}`,
      `sparkle://docs/${topic}`,
      {
        title: doc.title,
        description: doc.description,
        mimeType: "text/markdown",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: doc.content,
          },
        ],
      }),
    );
  }
}
