import { describe, it, expect, beforeEach } from "vitest";
import { SparkleClientsStore, SparkleAuthProvider } from "../auth.js";

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
  const TEST_PIN = "test-pin-1234";

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
    provider = new SparkleAuthProvider(TEST_PIN);
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
      expect(tokens.expires_in).toBe(3600);
      expect(tokens.scope).toBe("mcp:tools");
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
    });

    it("throws for invalid token", async () => {
      await expect(provider.verifyAccessToken("invalid")).rejects.toThrow("Invalid token");
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
        "Invalid token",
      );
    });
  });

  describe("cleanup", () => {
    it("removes expired tokens", async () => {
      const code = await createAuthCode(provider, mockClient, mockParams);
      const tokens = await provider.exchangeAuthorizationCode(mockClient, code);

      // Manually expire the token by accessing internal state
      const tokenMap = (provider as any).tokens as Map<string, any>;
      const tokenData = tokenMap.get(tokens.access_token)!;
      tokenData.expiresAt = Date.now() - 1000;

      provider.cleanup();

      await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow();
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

  provider.completeAuthorization(pendingId, "test-pin-1234", submitRes);
  return code;
}
