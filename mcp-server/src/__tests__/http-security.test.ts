// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { once } from "node:events";
import type { Server } from "node:http";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import express from "express";
import { createRequestParsers, MAX_REQUEST_BODY_BYTES } from "../http-security.js";

describe("MCP request parsing", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(...createRequestParsers());
    app.post("/mcp", (req, res) => res.json(req.body));
    app.post("/token", (req, res) => res.json(req.body));
    app.use(((error, _req, res, _next) => {
      res.status(error.status || 500).json({ type: error.type });
    }) as express.ErrorRequestHandler);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("accepts normal JSON tool requests", async () => {
    const body = { jsonrpc: "2.0", method: "tools/list", id: 1 };
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
  });

  it.each([
    ["br", brotliCompressSync],
    ["gzip", gzipSync],
    ["deflate", deflateSync],
  ] as const)(
    "rejects %s before decompressing unauthenticated input",
    async (encoding, compress) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Encoding": encoding },
        body: new Uint8Array(compress(Buffer.from('{"id":1}'))),
      });
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ type: "encoding.unsupported" });
      expect(
        (
          await fetch(`${baseUrl}/mcp`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })
        ).status,
      ).toBe(200);
    },
  );

  it("rejects JSON bodies over the byte limit", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "a".repeat(MAX_REQUEST_BODY_BYTES) }),
    });
    expect(response.status).toBe(413);
  });

  it("accepts a full Chinese note below the JSON byte limit", async () => {
    const body = { content: "筆".repeat(50_000) };
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
  });

  it("accepts OAuth form requests", async () => {
    const body = new URLSearchParams({ grant_type: "authorization_code", code: "test-code" });
    const response = await fetch(`${baseUrl}/token`, { method: "POST", body });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(Object.fromEntries(body));
  });

  it("rejects compressed OAuth forms", async () => {
    const response = await fetch(`${baseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Encoding": "gzip" },
      body: new Uint8Array(gzipSync("code=test")),
    });
    expect(response.status).toBe(415);
  });

  it("rejects excessive OAuth parameters", async () => {
    const body = new URLSearchParams(Array.from({ length: 33 }, (_, i) => [`key${i}`, "value"]));
    expect((await fetch(`${baseUrl}/token`, { method: "POST", body })).status).toBe(413);
  });

  it("rejects oversized OAuth forms", async () => {
    const body = new URLSearchParams({ code: "a".repeat(16 * 1024) });
    expect((await fetch(`${baseUrl}/token`, { method: "POST", body })).status).toBe(413);
  });
});
