// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSparkleServer } from "../server.js";
import { MAX_TOOL_INPUT_ELEMENTS } from "../http-security.js";

describe("MCP tool input limits", () => {
  let server: McpServer;
  let client: Client;

  beforeEach(async () => {
    server = createSparkleServer();
    client = new Client({ name: "security-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("continues to serve valid tool calls", async () => {
    const result = await client.callTool({
      name: "sparkle_guide",
      arguments: { topic: "overview" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "text" })]),
    );
  });

  it("rejects excessive array elements before schema validation", async () => {
    const result = await client.callTool({
      name: "sparkle_create_note",
      arguments: { title: "test", tags: Array(MAX_TOOL_INPUT_ELEMENTS + 1).fill(null) },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain(
      `more than the maximum of ${MAX_TOOL_INPUT_ELEMENTS} elements`,
    );
    const recovery = await client.callTool({
      name: "sparkle_guide",
      arguments: { topic: "overview" },
    });
    expect(recovery.isError).not.toBe(true);
  });

  it("rejects excessive object keys", async () => {
    const result = await client.callTool({
      name: "sparkle_create_note",
      arguments: Object.fromEntries(
        Array.from({ length: MAX_TOOL_INPUT_ELEMENTS + 1 }, (_, i) => [`key${i}`, null]),
      ),
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain(
      `more than the maximum of ${MAX_TOOL_INPUT_ELEMENTS} elements`,
    );
  });
});
