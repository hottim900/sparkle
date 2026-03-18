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

if (MCP_ISSUER_URL.startsWith("http://localhost")) {
  console.warn("WARNING: MCP_ISSUER_URL is localhost. Set to public HTTPS URL for production.");
}

// --- OAuth provider ---

const provider = new SparkleAuthProvider(process.env.MCP_AUTH_PIN);

// --- Express app ---

const app = express();
app.set("trust proxy", 1); // Behind Cloudflare Tunnel
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(
      `${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms from=${req.ip}`,
    );
  });
  next();
});
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// OAuth routes (/.well-known/*, /authorize, /token, /register, /revoke)
app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: new URL(MCP_ISSUER_URL),
    resourceServerUrl: new URL(`${MCP_ISSUER_URL}/mcp`),
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
  try {
    provider.completeAuthorization(pending_id, pin, res);
  } catch (error) {
    console.error("Error in authorization submission:", error);
    if (!res.headersSent) {
      res.status(500).send("Internal server error");
    }
  }
});

// --- MCP transport ---

const authMiddleware = requireBearerAuth({ verifier: provider });

// --- Session store ---

const MAX_SESSIONS = 10;

class SessionStore {
  private transports = new Map<string, StreamableHTTPServerTransport>();
  private createdAt = new Map<string, number>();

  get size(): number {
    return this.transports.size;
  }
  has(id: string): boolean {
    return this.transports.has(id);
  }
  get(id: string): StreamableHTTPServerTransport | undefined {
    return this.transports.get(id);
  }
  set(id: string, transport: StreamableHTTPServerTransport): void {
    this.transports.set(id, transport);
    this.createdAt.set(id, Date.now());
  }
  delete(id: string): boolean {
    this.createdAt.delete(id);
    return this.transports.delete(id);
  }
  entries(): IterableIterator<[string, StreamableHTTPServerTransport]> {
    return this.transports.entries();
  }
  staleSessionIds(maxAgeMs: number): string[] {
    const now = Date.now();
    const stale: string[] = [];
    for (const [id, created] of this.createdAt) {
      if (now - created > maxAgeMs) stale.push(id);
    }
    return stale;
  }
}

const sessions = new SessionStore();

function getSessionTransport(req: express.Request): StreamableHTTPServerTransport | undefined {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  return sessionId ? sessions.get(sessionId) : undefined;
}

/**
 * Respond when the client sends a session ID we don't recognize.
 *
 * Returns 404 (not 409) for expired sessions.
 *
 * Root cause (2026-03-18): MCP sessions are in-memory and lost on server restart.
 * After restart, Claude.ai sends tools/call with the old session ID. Per MCP spec,
 * the server should return 409 to tell the client to re-initialize. However,
 * Claude.ai's MCP client does NOT handle 409 — it gives up immediately with a
 * generic "Tool execution failed" error, never re-initializing.
 *
 * Discovered that Claude.ai DOES handle 404 correctly — it re-initializes a new
 * session transparently. JWT tokens survive restarts (key derived from stable PIN),
 * so the re-initialization succeeds without requiring the user to re-enter the PIN.
 *
 * This is a workaround for a Claude.ai client-side bug. If Claude.ai fixes their
 * 409 handling in the future, this can be changed back to spec-compliant 409.
 */
function sendSessionNotFound(req: express.Request, res: express.Response): void {
  const hasSessionId = !!req.headers["mcp-session-id"];
  const status = hasSessionId ? 404 : 400;
  const message = hasSessionId ? "Session not found. Please re-initialize." : "Missing session ID";

  if (hasSessionId) {
    console.log(`Session expired for ${req.body?.method ?? "SSE/DELETE"}, returning 404 to trigger re-init`);
  }

  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
}

// POST /mcp — handle MCP requests
app.post("/mcp", authMiddleware, async (req, res) => {
  try {
    const existing = getSessionTransport(req);
    if (existing) {
      await existing.handleRequest(req, res, req.body);
      return;
    }

    // Accept initialize requests even if a stale session-id is present (e.g. after server restart).
    // This saves a round-trip vs returning 409 first.
    if (isInitializeRequest(req.body)) {
      if (sessions.size >= MAX_SESSIONS) {
        res.status(503).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Too many active sessions" },
          id: null,
        });
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport);
          console.log(`MCP session created: ${id}`);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          sessions.delete(sid);
          console.log(`MCP session closed: ${sid}`);
        }
      };

      const server = createSparkleServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    sendSessionNotFound(req, res);
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
  const transport = getSessionTransport(req);
  if (!transport) {
    sendSessionNotFound(req, res);
    return;
  }
  await transport.handleRequest(req, res);
});

// DELETE /mcp — session termination
app.delete("/mcp", authMiddleware, async (req, res) => {
  const transport = getSessionTransport(req);
  if (!transport) {
    sendSessionNotFound(req, res);
    return;
  }
  try {
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("Error handling session termination:", error);
    if (!res.headersSent) {
      res.status(500).send("Error processing session termination");
    }
  }
});

// --- Cleanup & lifecycle ---

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

const cleanupTimer = setInterval(() => {
  provider.cleanup();

  for (const sessionId of sessions.staleSessionIds(SESSION_MAX_AGE_MS)) {
    const transport = sessions.get(sessionId);
    if (transport) {
      transport.close().catch(() => {});
      sessions.delete(sessionId);
      console.log(`MCP session evicted (stale): ${sessionId}`);
    }
  }
}, CLEANUP_INTERVAL_MS);

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log("Shutting down MCP HTTP server...");
  clearInterval(cleanupTimer);
  for (const [sessionId, transport] of sessions.entries()) {
    try {
      await transport.close();
      sessions.delete(sessionId);
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
