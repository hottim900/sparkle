#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createSparkleServer } from "./server.js";
import { SparkleAuthProvider } from "./auth.js";

// --- Env validation ---

if (!process.env.SPARKLE_AUTH_TOKEN) {
  console.error("ERROR: SPARKLE_AUTH_TOKEN environment variable is required");
  process.exit(1);
}

if (!process.env.MCP_AUTH_PIN) {
  console.error("ERROR: MCP_AUTH_PIN environment variable is required");
  process.exit(1);
}

const MCP_HTTP_PORT = parseInt(process.env.MCP_HTTP_PORT || "3001", 10);
const MCP_ISSUER_URL = process.env.MCP_ISSUER_URL || `http://localhost:${MCP_HTTP_PORT}`;

// --- OAuth provider ---

const provider = new SparkleAuthProvider(process.env.MCP_AUTH_PIN);

// --- Express app ---

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// OAuth routes (/.well-known/*, /authorize, /token, /register, /revoke)
app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: new URL(MCP_ISSUER_URL),
    scopesSupported: ["mcp:tools"],
    resourceName: "Sparkle MCP Server",
  }),
);

// Custom PIN submission handler (not part of SDK's OAuth router)
app.post("/authorize/submit", (req, res) => {
  const { pending_id, pin } = req.body;
  if (!pending_id || !pin) {
    res.status(400).send("Missing required fields");
    return;
  }
  provider.completeAuthorization(pending_id, pin, res);
});

// --- MCP transport ---

const authMiddleware = requireBearerAuth({ verifier: provider });
const transports = new Map<string, StreamableHTTPServerTransport>();

// POST /mcp — handle MCP requests
app.post("/mcp", authMiddleware, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) transports.delete(sid);
      };

      const server = createSparkleServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: No valid session ID provided" },
      id: null,
    });
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// GET /mcp — SSE stream
app.get("/mcp", authMiddleware, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  await transports.get(sessionId)!.handleRequest(req, res);
});

// DELETE /mcp — session termination
app.delete("/mcp", authMiddleware, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  try {
    await transports.get(sessionId)!.handleRequest(req, res);
  } catch (error) {
    console.error("Error handling session termination:", error);
    if (!res.headersSent) {
      res.status(500).send("Error processing session termination");
    }
  }
});

// --- Cleanup & lifecycle ---

// Periodically clean up expired OAuth state and stale sessions
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

const sessionCreatedAt = new Map<string, number>();

// Patch session tracking into transport creation
const originalSet = transports.set.bind(transports);
transports.set = (key: string, value: StreamableHTTPServerTransport) => {
  sessionCreatedAt.set(key, Date.now());
  return originalSet(key, value);
};
const originalDelete = transports.delete.bind(transports);
transports.delete = (key: string) => {
  sessionCreatedAt.delete(key);
  return originalDelete(key);
};

setInterval(() => {
  provider.cleanup();

  const now = Date.now();
  for (const [sessionId, createdAt] of sessionCreatedAt) {
    if (now - createdAt > SESSION_MAX_AGE_MS) {
      const transport = transports.get(sessionId);
      if (transport) {
        transport.close().catch(() => {});
        transports.delete(sessionId);
      }
    }
  }
}, CLEANUP_INTERVAL_MS);

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log("Shutting down MCP HTTP server...");
  for (const [sessionId, transport] of transports) {
    try {
      await transport.close();
      transports.delete(sessionId);
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// --- Start ---

app.listen(MCP_HTTP_PORT, () => {
  console.log(`Sparkle MCP HTTP server listening on port ${MCP_HTTP_PORT}`);
  console.log(`Issuer URL: ${MCP_ISSUER_URL}`);
});
