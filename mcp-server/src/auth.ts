import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

// --- Clients Store ---

export class SparkleClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId);
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): OAuthClientInformationFull {
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: randomUUID(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this.clients.set(full.client_id, full);
    return full;
  }
}

// --- Auth Provider ---

interface PendingAuth {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  createdAt: number;
}

interface StoredCode {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
  createdAt: number;
}

interface StoredToken {
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource?: URL;
}

const TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const PENDING_AUTH_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export class SparkleAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new SparkleClientsStore();
  private codes = new Map<string, StoredCode>();
  private tokens = new Map<string, StoredToken>();
  private pendingAuths = new Map<string, PendingAuth>();

  private readonly pin: string;

  constructor(pin: string) {
    this.pin = pin;
  }

  /**
   * Renders an HTML form asking for the PIN.
   * The form POSTs to /authorize/submit with the pending auth ID.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const pendingId = randomUUID();
    this.pendingAuths.set(pendingId, {
      client,
      params,
      createdAt: Date.now(),
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sparkle MCP — 授權</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 400px; margin: 80px auto; padding: 0 20px; }
    h1 { font-size: 1.4em; }
    .info { color: #666; margin: 1em 0; }
    input[type=password] { width: 100%; padding: 10px; font-size: 1em; border: 1px solid #ccc; border-radius: 6px; box-sizing: border-box; }
    button { margin-top: 12px; padding: 10px 24px; font-size: 1em; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    .error { color: #dc2626; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>Sparkle MCP 授權</h1>
  <p class="info">應用程式「${escapeHtml(client.client_name || client.client_id)}」要求存取你的 Sparkle 知識庫。</p>
  <form method="POST" action="/authorize/submit">
    <input type="hidden" name="pending_id" value="${pendingId}">
    <label for="pin">請輸入 PIN：</label>
    <input type="password" id="pin" name="pin" required autofocus>
    <button type="submit">允許存取</button>
  </form>
</body>
</html>`);
  }

  /**
   * Called by our custom /authorize/submit route after PIN validation.
   * Generates an auth code and redirects to the client's redirect_uri.
   */
  completeAuthorization(pendingId: string, pin: string, res: Response): void {
    const pending = this.pendingAuths.get(pendingId);
    if (!pending) {
      res.status(400).send(errorPage("授權請求已過期或無效。請重新開始。"));
      return;
    }

    if (Date.now() - pending.createdAt > PENDING_AUTH_EXPIRY_MS) {
      this.pendingAuths.delete(pendingId);
      res.status(400).send(errorPage("授權請求已過期。請重新開始。"));
      return;
    }

    if (pin !== this.pin) {
      res.status(403).send(errorPage("PIN 錯誤。請返回重試。"));
      return;
    }

    this.pendingAuths.delete(pendingId);

    const code = randomUUID();
    this.codes.set(code, {
      client: pending.client,
      params: pending.params,
      createdAt: Date.now(),
    });

    const { redirectUri, state } = pending.params;
    if (!pending.client.redirect_uris.some((uri) => uri.toString() === redirectUri)) {
      throw new InvalidRequestError("Unregistered redirect_uri");
    }

    const targetUrl = new URL(redirectUri);
    targetUrl.searchParams.set("code", code);
    if (state !== undefined) {
      targetUrl.searchParams.set("state", state);
    }
    res.redirect(targetUrl.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const codeData = this.codes.get(authorizationCode);
    if (!codeData) {
      throw new Error("Invalid authorization code");
    }
    return codeData.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const codeData = this.codes.get(authorizationCode);
    if (!codeData) {
      throw new Error("Invalid authorization code");
    }

    if (codeData.client.client_id !== client.client_id) {
      throw new Error("Authorization code was not issued to this client");
    }

    if (Date.now() - codeData.createdAt > CODE_EXPIRY_MS) {
      this.codes.delete(authorizationCode);
      throw new Error("Authorization code has expired");
    }

    this.codes.delete(authorizationCode);

    const accessToken = randomUUID();
    const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
    this.tokens.set(accessToken, {
      clientId: client.client_id,
      scopes: codeData.params.scopes || [],
      expiresAt,
      resource,
    });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: Math.floor(TOKEN_EXPIRY_MS / 1000),
      scope: (codeData.params.scopes || []).join(" "),
    };
  }

  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    _refreshToken: string,
    _scopes?: string[],
    _resource?: URL,
  ): Promise<OAuthTokens> {
    throw new Error("Refresh tokens are not supported. Please re-authorize.");
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const tokenData = this.tokens.get(token);
    if (!tokenData) {
      throw new Error("Invalid token");
    }

    if (Date.now() > tokenData.expiresAt) {
      this.tokens.delete(token);
      throw new Error("Token has expired");
    }

    return {
      token,
      clientId: tokenData.clientId,
      scopes: tokenData.scopes,
      expiresAt: Math.floor(tokenData.expiresAt / 1000),
      resource: tokenData.resource,
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    this.tokens.delete(request.token);
  }

  /**
   * Clean up expired entries to prevent memory leaks.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [id, pending] of this.pendingAuths) {
      if (now - pending.createdAt > PENDING_AUTH_EXPIRY_MS) {
        this.pendingAuths.delete(id);
      }
    }
    for (const [code, data] of this.codes) {
      if (now - data.createdAt > CODE_EXPIRY_MS) {
        this.codes.delete(code);
      }
    }
    for (const [token, data] of this.tokens) {
      if (now > data.expiresAt) {
        this.tokens.delete(token);
      }
    }
  }
}

// --- Helpers ---

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sparkle MCP — 錯誤</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 400px; margin: 80px auto; padding: 0 20px; }
    .error { color: #dc2626; }
  </style>
</head>
<body>
  <h1>Sparkle MCP</h1>
  <p class="error">${escapeHtml(message)}</p>
</body>
</html>`;
}
