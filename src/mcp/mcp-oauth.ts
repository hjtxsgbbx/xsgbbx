/**
 * MCP OAuth authentication — adapted from Claude Code's services/mcp/auth.ts.
 *
 * Supports the MCP authorization flow:
 *   1. Client requests /authorize
 *   2. Server redirects to OAuth provider
 *   3. User completes browser-based auth
 *   4. Client exchanges code for access token
 *   5. Token used in subsequent MCP requests
 */

import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MCPOAuthConfig {
  serverUrl: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  redirectPort?: number;
  /** Path on the MCP server for authorization */
  authorizePath?: string;
  /** Path on the MCP server for token exchange */
  tokenPath?: string;
}

export interface MCPTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

export interface MCPOAuthState {
  tokens: MCPTokenSet | null;
  isAuthenticating: boolean;
  lastError?: string;
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return Buffer.from(digest).toString("base64url");
}

// ---------------------------------------------------------------------------
// OAuth Client
// ---------------------------------------------------------------------------

export class MCPOAuthClient extends EventEmitter {
  private config: MCPOAuthConfig;
  private state: MCPOAuthState = {
    tokens: null,
    isAuthenticating: false,
  };
  private codeVerifier: string | null = null;

  constructor(config: MCPOAuthConfig) {
    super();
    this.config = config;
  }

  getTokens(): MCPTokenSet | null {
    return this.state.tokens;
  }

  isAuthenticated(): boolean {
    const tokens = this.state.tokens;
    if (!tokens) return false;
    if (tokens.expiresAt && tokens.expiresAt < Date.now()) return false;
    return true;
  }

  getAuthHeaders(): Record<string, string> {
    const tokens = this.state.tokens;
    if (!tokens) return {};
    return {
      Authorization: `Bearer ${tokens.accessToken}`,
    };
  }

  /**
   * Start the OAuth authorization flow.
   * Opens a browser window and starts a local redirect server.
   */
  async authorize(): Promise<MCPTokenSet> {
    if (this.state.isAuthenticating) {
      throw new Error("Authorization already in progress");
    }

    this.state.isAuthenticating = true;
    this.state.lastError = undefined;

    try {
      this.codeVerifier = generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(this.codeVerifier);
      const state = randomBytes(16).toString("hex");
      const port = this.config.redirectPort || await findAvailablePort();

      // Start local redirect server
      const authCode = await this.startRedirectServer(port, state);

      // Exchange code for token
      const tokens = await this.exchangeCode(authCode, this.codeVerifier, port);

      this.state.tokens = tokens;
      this.state.isAuthenticating = false;
      this.emit("authenticated", tokens);
      return tokens;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.state.lastError = msg;
      this.state.isAuthenticating = false;
      this.emit("error", msg);
      throw err;
    }
  }

  /**
   * Refresh the access token.
   */
  async refresh(): Promise<MCPTokenSet | null> {
    const tokens = this.state.tokens;
    if (!tokens?.refreshToken) return null;

    try {
      const tokenUrl = `${this.config.serverUrl}${this.config.tokenPath || "/token"}`;
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      });

      if (this.config.clientId) {
        body.set("client_id", this.config.clientId);
      }
      if (this.config.clientSecret) {
        body.set("client_secret", this.config.clientSecret);
      }

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: HTTP ${response.status}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      const newTokens: MCPTokenSet = {
        accessToken: data.access_token as string,
        refreshToken: (data.refresh_token as string) || tokens.refreshToken,
        expiresAt: data.expires_in
          ? Date.now() + (data.expires_in as number) * 1000
          : undefined,
        tokenType: data.token_type as string,
        scope: data.scope as string,
      };

      this.state.tokens = newTokens;
      this.emit("refreshed", newTokens);
      return newTokens;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.state.lastError = msg;
      this.emit("error", msg);
      return null;
    }
  }

  /**
   * Start a local HTTP server to receive the OAuth redirect.
   */
  private startRedirectServer(port: number, stateParam: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const server: Server = createServer((req, res) => {
        const url = new URL(req.url || "/", `http://localhost:${port}`);

        // Verify state parameter to prevent CSRF
        const returnedState = url.searchParams.get("state");
        if (returnedState !== stateParam) {
          res.writeHead(400);
          res.end("Invalid state parameter");
          server.close();
          reject(new Error("OAuth state mismatch"));
          return;
        }

        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(oauthErrorHtml(error));
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code) {
          res.writeHead(400);
          res.end("Missing authorization code");
          server.close();
          reject(new Error("No authorization code received"));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(oauthSuccessHtml());
        server.close();
        resolve(code);
      });

      server.listen(port, () => {
        const scopes = (this.config.scopes || ["mcp"]).join(" ");
        const authUrl = buildAuthUrl(
          this.config.serverUrl,
          this.config.authorizePath || "/authorize",
          `http://localhost:${port}`,
          this.config.clientId || "agent_1",
          stateParam,
          scopes,
        );

        this.emit("open-browser", authUrl);
        // Auto-open browser
        openBrowser(authUrl).catch(() => {
          this.emit("auth-url", authUrl);
        });
      });

      server.on("error", (err) => {
        reject(new Error(`Failed to start OAuth redirect server: ${err.message}`));
      });
    });
  }

  /**
   * Exchange authorization code for tokens.
   */
  private async exchangeCode(
    code: string,
    verifier: string,
    port: number,
  ): Promise<MCPTokenSet> {
    const tokenUrl = `${this.config.serverUrl}${this.config.tokenPath || "/token"}`;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `http://localhost:${port}`,
      code_verifier: verifier,
    });

    if (this.config.clientId) {
      body.set("client_id", this.config.clientId);
    }
    if (this.config.clientSecret) {
      body.set("client_secret", this.config.clientSecret);
    }

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed: HTTP ${response.status} — ${text}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string | undefined,
      expiresAt: data.expires_in
        ? Date.now() + (data.expires_in as number) * 1000
        : undefined,
      tokenType: data.token_type as string,
      scope: data.scope as string,
    };
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function buildAuthUrl(
  serverUrl: string,
  authPath: string,
  redirectUri: string,
  clientId: string,
  state: string,
  scopes: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: scopes,
    code_challenge_method: "S256",
  });
  // code_challenge is added dynamically during authorization

  const base = `${serverUrl}${authPath}`;
  return `${base}?${params.toString()}`;
}

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Could not find available port")));
      }
    });
    server.on("error", reject);
  });
}

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const cmd =
    platform === "win32"
      ? `start "" "${url}"`
      : platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  const { execSync } = await import("child_process");
  execSync(cmd, { stdio: "ignore" });
}

function oauthSuccessHtml(): string {
  return `<!DOCTYPE html>
<html><head><title>Authentication Complete</title></head>
<body style="font-family:system-ui;text-align:center;padding-top:80px;background:#111;color:#eee;">
  <h1 style="color:#4f8;">&#10003; Authentication Successful</h1>
  <p>You may close this window and return to agent_1.</p>
</body></html>`;
}

function oauthErrorHtml(error: string): string {
  return `<!DOCTYPE html>
<html><head><title>Authentication Failed</title></head>
<body style="font-family:system-ui;text-align:center;padding-top:80px;background:#111;color:#eee;">
  <h1 style="color:#f44;">&#10007; Authentication Failed</h1>
  <p>${escapeHtml(error)}</p>
  <p>Please close this window and try again.</p>
</body></html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
