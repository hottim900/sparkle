#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSparkleServer } from "./server.js";

// Start stdio transport
async function main(): Promise<void> {
  if (!process.env.SPARKLE_AUTH_TOKEN) {
    console.error("ERROR: SPARKLE_AUTH_TOKEN environment variable is required");
    process.exit(1);
  }

  const server = createSparkleServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sparkle MCP server running via stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
