#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSearchTools } from "./tools/search.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { registerWorkflowTools } from "./tools/workflow.js";
import { registerMetaTools } from "./tools/meta.js";

const server = new McpServer({
  name: "sparkle-mcp-server",
  version: "1.0.0",
});

// Register all tools
registerSearchTools(server);
registerReadTools(server);
registerWriteTools(server);
registerWorkflowTools(server);
registerMetaTools(server);

// Start stdio transport
async function main(): Promise<void> {
  if (!process.env.SPARKLE_AUTH_TOKEN) {
    console.error("ERROR: SPARKLE_AUTH_TOKEN environment variable is required");
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sparkle MCP server running via stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
