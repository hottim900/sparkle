import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTools } from "./tools/search.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { registerCategoryTools } from "./tools/categories.js";
import { registerWorkflowTools } from "./tools/workflow.js";
import { registerMetaTools } from "./tools/meta.js";
import { registerGuideTools } from "./tools/guide.js";
import { registerVaultTools } from "./tools/vault.js";
import { SPARKLE_INSTRUCTIONS } from "./docs/instructions.js";
import { registerDocResources } from "./docs/resources.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export function createSparkleServer(): McpServer {
  const server = new McpServer(
    { name: "sparkle", version: pkg.version },
    { instructions: SPARKLE_INSTRUCTIONS },
  );

  registerSearchTools(server);
  registerReadTools(server);
  registerWriteTools(server);
  registerCategoryTools(server);
  registerWorkflowTools(server);
  registerMetaTools(server);
  registerGuideTools(server);
  registerVaultTools(server);
  registerDocResources(server);

  return server;
}
