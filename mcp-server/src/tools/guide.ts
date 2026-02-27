import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DOCS } from "../docs/content.js";

export function registerGuideTools(server: McpServer): void {
  const validTopics = Object.keys(DOCS);

  server.registerTool(
    "sparkle_guide",
    {
      title: "Sparkle Guide",
      description: `Query Sparkle documentation by topic. Available topics: ${validTopics.join(", ")}.`,
      inputSchema: {
        topic: z
          .enum([validTopics[0], ...validTopics.slice(1)])
          .describe("Documentation topic to retrieve"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ topic }) => {
      const doc = DOCS[topic];
      if (!doc) {
        return {
          content: [
            {
              type: "text",
              text: `Unknown topic: ${topic}. Available: ${validTopics.join(", ")}`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: doc.content }],
      };
    },
  );
}
