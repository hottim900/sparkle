// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SparkleClientsStore, SparkleAuthProvider } from "../auth.js";
import { createHmac, createSecretKey } from "node:crypto";
import { decodeJwt, SignJWT } from "jose";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { Request, Response } from "express";

const TEST_PIN = "test-pin-1234";
const RESOURCE = new URL("https://sparkle.example.com/mcp");

describe("SparkleClientsStore", () => {
  let store: SparkleClientsStore;

  beforeEach(() => {
    store = new SparkleClientsStore();
  });

  it("returns undefined for unknown client", () => {
    expect(store.getClient("nonexistent")).toBeUndefined();
  });

  it("registers and retrieves a client", () => {
    const client = store.registerClient({
      redirect_uris: [new URL("https://example.com/callback")],
      client_name: "Test App",
    });

    expect(client.client_id).toBeDefined();
    expect(client.client_id_issued_at).toBeDefined();
    expect(client.client_name).toBe("Test App");

    const retrieved = store.getClient(client.client_id);
    expect(retrieved).toEqual(client);
  });
});

describe("SparkleAuthProvider", () => {
  let provider: SparkleAuthProvider;

  const mockClient = {
    client_id: "test-client-id",
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: [new URL("https://example.com/callback")],
    client_name: "Test App",
  };

  const mockParams = {
    codeChallenge: "test-challenge-abc123",
    redirectUri: "https://example.com/callback",
    state: "test-state",
    scopes: ["mcp:tools"],
  };

  beforeEach(() => {
    provider = new SparkleAuthProvider(TEST_PIN, RESOURCE);
  });

  describe("authorize", () => {
    it("renders PIN form HTML", async () => {
      let sentHtml = "";
      const mockRes = {
        setHeader: () => {},
        send: (html: string) => {
          sentHtml = html;
        },
      } as any;

      await provider.authorize(mockClient, mockParams, mockRes);

      expect(sentHtml).toContain("Sparkle MCP 授權");
      expect(sentHtml).toContain('name="pin"');
      expect(sentHtml).toContain('name="pending_id"');
      expect(sentHtml).toContain("Test App");
    });
  });

  describe("completeAuthorization", () => {
    it("rejects invalid pending ID", () => {
      let statusCode = 0;
      let sentBody = "";
      const mockRes = {
        status: (code: number) => ({
          send: (body: string) => {
            statusCode = code;
            sentBody = body;
          },
        }),
      } as any;

      provider.completeAuthorization("invalid-id", TEST_PIN, mockRes);
      expect(statusCode).toBe(400);
      expect(sentBody).toContain("過期或無效");
    });

    it("rejects wrong PIN", async () => {
      // First create a pending auth
      let pendingId = "";
      const authorizeRes = {
        setHeader: () => {},
        send: (html: string) => {
          const match = html.match(/value="([^"]+)"/);
          if (match) pendingId = match[1];
        },
      } as any;
      await provider.authorize(mockClient, mockParams, authorizeRes);

      let statusCode = 0;
      let sentBody = "";
      const submitRes = {
        status: (code: number) => ({
          send: (body: string) => {
            statusCode = code;
            sentBody = body;
          },
        }),
      } as any;

      provider.completeAuthorization(pendingId, "wrong-pin", submitRes);
      expect(statusCode).toBe(403);
      expect(sentBody).toContain("PIN 錯誤");
    });

    it("redirects with auth code on correct PIN", async () => {
      let pendingId = "";
      const authorizeRes = {
        setHeader: () => {},
        send: (html: string) => {
          const match = html.match(/value="([^"]+)"/);
          if (match) pendingId = match[1];
        },
      } as any;
      await provider.authorize(mockClient, mockParams, authorizeRes);

      let redirectUrl = "";
      const submitRes = {
        redirect: (url: string) => {
          redirectUrl = url;
        },
      } as any;

      provider.completeAuthorization(pendingId, TEST_PIN, submitRes);

      expect(redirectUrl).toContain("https://example.com/callback");
      expect(redirectUrl).toContain("code=");
      expect(redirectUrl).toContain("state=test-state");
    });
  });

  describe("challengeForAuthorizationCode", () => {
    it("returns the stored code challenge", async () => {
      const code = await createAuthCode(provider, mockClient, mockParams);
      const challenge = await provider.challengeForAuthorizationCode(mockClient, code);
      expect(challenge).toBe("test-challenge-abc123");
    });

    it("throws for invalid code", async () => {
      await expect(provider.challengeForAuthorizationCode(mockClient, "invalid")).rejects.toThrow(
        "Invalid authorization code",
      );
    });
  });

  describe("exchangeAuthorizationCode", () => {
    it("returns access token for valid code", async () => {
      const code = await createAuthCode(provider, mockClient, mockParams);
      const tokens = await provider.exchangeAuthorizationCode(mockClient, code);

      expect(tokens.access_token).toBeDefined();
      expect(tokens.token_type).toBe("bearer");
      expect(tokens.expires_in).toBe(365 * 24 * 60 * 60);
      expect(tokens.scope).toBe("mcp:tools");
      expect(decodeJwt(tokens.access_token).aud).toBe(RESOURCE.href);
    });

    it("rejects token issuance for another resource", async () => {
      const code = await createAuthCode(provider, mockClient, mockParams);
      await expect(
        provider.exchangeAuthorizationCode(
          mockClient,
          code,
          undefined,
          undefined,
          new URL("https://other.example.com/mcp"),
        ),
      ).rejects.toThrow("Token resource must match this MCP server");
    });

    it("rejects reuse of the same code", async () => {
      const code = await createAuthCode(provider, mockClient, mockParams);
      await provider.exchangeAuthorizationCode(mockClient, code);

      await expect(provider.exchangeAuthorizationCode(mockClient, code)).rejects.toThrow(
        "Invalid authorization code",
      );
    });

    it("rejects code from different client", async () => {
      const code = await createAuthCode(provider, mockClient, mockParams);
      const otherClient = { ...mockClient, client_id: "other-client" };

      await expect(provider.exchangeAuthorizationCode(otherClient, code)).rejects.toThrow(
        "not issued to this client",
      );
    });
  });

  describe("verifyAccessToken", () => {
    it("returns AuthInfo for valid token", async () => {
      const code = await createAuthCode(provider, mockClient, mockParams);
      const tokens = await provider.exchangeAuthorizationCode(mockClient, code);
      const authInfo = await provider.verifyAccessToken(tokens.access_token);

      expect(authInfo.clientId).toBe("test-client-id");
      expect(authInfo.scopes).toEqual(["mcp:tools"]);
      expect(authInfo.expiresAt).toBeDefined();
      expect(authInfo.resource?.href).toBe(RESOURCE.href);
    });

    it.each([undefined, "https://other.example.com/mcp"])(
      "rejects correctly signed tokens with invalid audience %s",
      async (aud) => {
        const key = createSecretKey(
          createHmac("sha256", "sparkle-mcp-jwt-key").update(TEST_PIN).digest(),
        );
        const token = await new SignJWT({ sub: mockClient.client_id, aud })
          .setProtectedHeader({ alg: "HS256" })
          .setExpirationTime("1h")
          .sign(key);
        await expect(provider.verifyAccessToken(token)).rejects.toThrow("Invalid or expired token");
      },
    );

    it("throws for invalid token", async () => {
      await expect(provider.verifyAccessToken("invalid")).rejects.toThrow(
        "Invalid or expired token",
      );
    });
  });

  describe("revokeToken", () => {
    it("revokes a token so it becomes invalid", async () => {
      const code = await createAuthCode(provider, mockClient, mockParams);
      const tokens = await provider.exchangeAuthorizationCode(mockClient, code);

      // Token works before revocation
      await expect(provider.verifyAccessToken(tokens.access_token)).resolves.toBeDefined();

      // Revoke
      await provider.revokeToken!(mockClient, { token: tokens.access_token });

      // Token no longer works
      await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow(
        "Token has been revoked",
      );
    });
  });

  describe("requireBearerAuth", () => {
    async function authenticateToken(token: string) {
      const request = { headers: { authorization: `Bearer ${token}` } } as Request;
      const response = {
        set: vi.fn().mockReturnThis(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const next = vi.fn();

      await requireBearerAuth({ verifier: provider, expectedResource: RESOURCE })(
        request,
        response as unknown as Response,
        next,
      );

      return { request, response, next };
    }

    it("authenticates a token issued for this MCP server", async () => {
      const code = await createAuthCode(provider, mockClient, mockParams);
      const tokens = await provider.exchangeAuthorizationCode(mockClient, code);
      const { request, response, next } = await authenticateToken(tokens.access_token);

      expect(next).toHaveBeenCalledOnce();
      expect(response.status).not.toHaveBeenCalled();
      expect(request.auth?.resource?.href).toBe(RESOURCE.href);
    });

    it.each([undefined, "https://other.example.com/mcp"])(
      "returns a 401 challenge for a signed token with invalid audience %s",
      async (aud) => {
        const key = createSecretKey(
          createHmac("sha256", "sparkle-mcp-jwt-key").update(TEST_PIN).digest(),
        );
        const token = await new SignJWT({ sub: mockClient.client_id, aud })
          .setProtectedHeader({ alg: "HS256" })
          .setExpirationTime("1h")
          .sign(key);
        const { response, next } = await authenticateToken(token);

        expect(next).not.toHaveBeenCalled();
        expect(response.status).toHaveBeenCalledWith(401);
        expect(response.json).toHaveBeenCalledWith({
          error: "invalid_token",
          error_description: "Invalid or expired token",
        });
        expect(response.set).toHaveBeenCalledWith(
          "WWW-Authenticate",
          expect.stringContaining('Bearer error="invalid_token"'),
        );
      },
    );

    it("returns a 401 challenge for a revoked token", async () => {
      const code = await createAuthCode(provider, mockClient, mockParams);
      const tokens = await provider.exchangeAuthorizationCode(mockClient, code);
      await provider.revokeToken(mockClient, { token: tokens.access_token });
      const { response, next } = await authenticateToken(tokens.access_token);

      expect(next).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(401);
      expect(response.json).toHaveBeenCalledWith({
        error: "invalid_token",
        error_description: "Token has been revoked",
      });
    });
  });

  describe("cleanup", () => {
    it("cleans up expired pending auths and codes", () => {
      // Access internal maps to verify cleanup works
      const pendingAuths = (provider as any).pendingAuths as Map<string, any>;
      const codes = (provider as any).codes as Map<string, any>;

      pendingAuths.set("old-pending", { createdAt: 0, attempts: 0 });
      codes.set("old-code", { createdAt: 0 });

      provider.cleanup();

      expect(pendingAuths.has("old-pending")).toBe(false);
      expect(codes.has("old-code")).toBe(false);
    });
  });
});

// --- Helper ---

/**
 * Simulates the full authorize → completeAuthorization flow, returns the auth code.
 */
async function createAuthCode(
  provider: SparkleAuthProvider,
  client: any,
  params: any,
): Promise<string> {
  let pendingId = "";
  const authorizeRes = {
    setHeader: () => {},
    send: (html: string) => {
      const match = html.match(/value="([^"]+)"/);
      if (match) pendingId = match[1];
    },
  } as any;

  await provider.authorize(client, params, authorizeRes);

  let code = "";
  const submitRes = {
    redirect: (url: string) => {
      const parsed = new URL(url);
      code = parsed.searchParams.get("code")!;
    },
  } as any;

  provider.completeAuthorization(pendingId, TEST_PIN, submitRes);
  return code;
}
