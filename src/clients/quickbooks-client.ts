import dotenv from "dotenv";
import QuickBooks from "node-quickbooks";
import OAuthClient from "intuit-oauth";
import http from 'http';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';
import { TokenStore } from './token-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Compiled to dist/clients/quickbooks-client.js, so the project root is two levels up.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// Load static app credentials from .env regardless of the process CWD — an MCP
// server is spawned by its client, which may set an arbitrary working directory.
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const client_id = process.env.QUICKBOOKS_CLIENT_ID;
const client_secret = process.env.QUICKBOOKS_CLIENT_SECRET;
const environment = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox';
const redirect_uri = process.env.QUICKBOOKS_REDIRECT_URI || 'http://localhost:8000/callback';

// Unlike upstream's env-format store, this fork stores only rotating tokens as
// JSON. Static credentials remain in .env; explicit host environment values win.
const tokenStorePathOverride = process.env.QUICKBOOKS_TOKEN_STORE_PATH?.trim();
if (tokenStorePathOverride && !path.isAbsolute(tokenStorePathOverride)) {
  throw new Error('QUICKBOOKS_TOKEN_STORE_PATH must be an absolute path to a JSON token file');
}
const TOKEN_STORE_PATH = tokenStorePathOverride || path.join(PROJECT_ROOT, '.qbo-tokens.json');

// When the refresh token is dead, auto-launch the browser re-auth flow (true) or
// fail fast with a "run npm run auth" message (false). Defaults to on for local use.
const AUTO_REAUTH = (process.env.QBO_AUTO_REAUTH ?? 'true').toLowerCase() !== 'false';

// Refresh the access token this long before it actually expires so a token never
// dies in the middle of an in-flight API request.
const EXPIRY_SKEW_MS = 2 * 60 * 1000;

if (!client_id || !client_secret || !redirect_uri) {
  throw Error("Client ID, Client Secret and Redirect URI must be set in environment variables");
}

const SUCCESS_HTML = `
  <html>
    <body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;margin:0;font-family:Arial, sans-serif;background-color:#f5f5f5;">
      <h2 style="color:#2E8B57;">✓ Successfully connected to QuickBooks!</h2>
      <p>You can close this window now.</p>
    </body>
  </html>
`;

const ERROR_HTML = `
  <html>
    <body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;margin:0;font-family:Arial, sans-serif;background-color:#fff0f0;">
      <h2 style="color:#d32f2f;">Error connecting to QuickBooks</h2>
      <p>Please check the console for more details.</p>
    </body>
  </html>
`;

type RefreshResult = { access_token: string; expires_in: number };

export class QuickbooksClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly environment: string;
  private readonly redirectUri: string;
  private readonly store: TokenStore;
  private readonly oauthClient: OAuthClient;
  private readonly autoReauth: boolean;

  private refreshToken?: string;
  private realmId?: string;
  private accessToken?: string;
  private accessTokenExpiry?: Date;

  private quickbooksInstance?: QuickBooks;
  private builtForAccessToken?: string;

  // Single-flight guards: at most one token refresh and one browser flow run at a
  // time. Concurrent tool calls share the in-flight promise instead of each firing
  // their own refresh, which would race the rotating refresh token and invalidate
  // the losers, or stampede N browser tabs during re-auth.
  private refreshPromise?: Promise<RefreshResult>;
  private oauthFlowPromise?: Promise<void>;
  private authPromise?: Promise<QuickBooks>;

  constructor(config: {
    clientId: string;
    clientSecret: string;
    environment: string;
    redirectUri: string;
    store: TokenStore;
    autoReauth?: boolean;
  }) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.environment = config.environment;
    this.redirectUri = config.redirectUri;
    this.store = config.store;
    this.autoReauth = config.autoReauth ?? AUTO_REAUTH;

    // The gitignored JSON store is the source of truth for the rotating tokens.
    // Fall back to .env once to migrate an existing setup; the next persist writes
    // them into the store and .env no longer needs them.
    const persisted = this.store.load();
    this.refreshToken = persisted.refresh_token ?? process.env.QUICKBOOKS_REFRESH_TOKEN;
    this.realmId = persisted.realm_id ?? process.env.QUICKBOOKS_REALM_ID;
    if (this.refreshToken && !persisted.refresh_token) {
      this.persistTokens(); // migrate tokens out of .env into the store
    }

    this.oauthClient = new OAuthClient({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      environment: this.environment,
      redirectUri: this.redirectUri,
    });
  }

  private persistTokens(): void {
    // Persist only the long-lived rotating tokens. The access token is deliberately
    // NOT persisted: reusing a clock-valid-but-server-revoked token across restarts
    // would hide a revocation until expiry. A fresh launch always re-mints it (one
    // ~200ms refresh), which surfaces a dead refresh token immediately via the
    // invalid_grant path.
    this.store.save({
      refresh_token: this.refreshToken,
      realm_id: this.realmId,
    });
  }

  /** Interactive browser authorization. Single-flight: concurrent callers share one flow. */
  async startOAuthFlow(): Promise<void> {
    if (this.oauthFlowPromise) {
      return this.oauthFlowPromise;
    }
    this.oauthFlowPromise = this.runOAuthFlow().finally(() => {
      this.oauthFlowPromise = undefined;
    });
    return this.oauthFlowPromise;
  }

  private runOAuthFlow(): Promise<void> {
    let port = 8000;
    let host = 'localhost';
    let flowRedirectUri: string;
    try {
      const redirect = new URL(this.redirectUri);
      if (redirect.pathname !== '/callback' || redirect.search || redirect.hash || redirect.username || redirect.password) {
        throw new Error('Unsupported callback URL');
      }
      if (this.environment === 'production') {
        if (redirect.protocol !== 'https:') throw new Error('HTTPS is required');
      } else {
        if (redirect.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname)) {
          throw new Error('An HTTP loopback callback is required');
        }
        port = Number(redirect.port || 80);
        if (port === 0) throw new Error('A fixed callback port is required');
        host = redirect.hostname === '[::1]' ? '::1' : redirect.hostname;
      }
      flowRedirectUri = redirect.toString();
    } catch {
      return Promise.reject(new Error(this.environment === 'production'
        ? 'Production authorization requires QUICKBOOKS_REDIRECT_URI to be a registered HTTPS /callback URL without credentials, query, or fragment, forwarded to local port 8000.'
        : 'Sandbox authorization requires QUICKBOOKS_REDIRECT_URI to be a registered HTTP loopback /callback URL (localhost, 127.0.0.1, or [::1]), without credentials, query, or fragment. The configured port is used.'));
    }
    // Sandbox binds the configured loopback host/port. Explicit production uses a
    // registered HTTPS callback forwarded to this server; auto-reauth never does.
    const flowClient = new OAuthClient({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      environment: this.environment,
      redirectUri: flowRedirectUri,
    });
    const expectedState = crypto.randomBytes(24).toString('hex');
    return new Promise((resolve, reject) => {
      let codeExchangeStarted = false;
      const server = http.createServer(async (req, res) => {
        let callback: URL;
        try {
          callback = new URL(req.url || '/', flowRedirectUri);
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid callback URL.');
          return;
        }
        if (callback.pathname !== '/callback') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }
        // Check state before claiming the single-use code exchange. A bad
        // callback must not prevent the legitimate browser from completing.
        if (callback.searchParams.get('state') !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Invalid or missing state parameter.');
          return;
        }
        if (codeExchangeStarted) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body>Authorization is already processing.</body></html>');
          return;
        }
        codeExchangeStarted = true;
        try {
          // Pass only known callback fields, encoded from WHATWG-parsed values.
          // Selecting each first value keeps state validation and token exchange
          // consistent even when a callback contains duplicate parameters.
          const exchangeParams = new URLSearchParams();
          for (const field of ['code', 'state', 'realmId', 'error', 'error_description']) {
            const value = callback.searchParams.get(field);
            if (value !== null) exchangeParams.set(field, value);
          }
          const response = await flowClient.createToken(`/callback?${exchangeParams.toString()}`);
          const tokens = response.token;
          if (!tokens.refresh_token || !tokens.realmId) {
            throw new Error('OAuth response did not include required tokens');
          }
          this.refreshToken = tokens.refresh_token;
          this.realmId = tokens.realmId;
          this.accessToken = undefined;
          this.accessTokenExpiry = undefined;
          this.persistTokens();
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(SUCCESS_HTML);
          setTimeout(() => {
            server.close();
            resolve();
          }, 1000);
        } catch {
          // SDK errors can contain authorization codes, tokens, and app secrets.
          console.error('QuickBooks authorization failed. Check the app configuration and token-store permissions.');
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(ERROR_HTML);
          server.close();
          reject(new Error('QuickBooks authorization failed. Check the app configuration and token-store permissions.'));
        }
      });

      server.on('error', () => {
        reject(new Error(`Could not start the QuickBooks OAuth callback server on port ${port}.`));
      });
      // The callback listener always binds to a loopback interface.
      server.listen(port, host, async () => {
        try {
          const authUri = flowClient
            .authorizeUri({ scope: [OAuthClient.scopes.Accounting as string], state: expectedState })
            .toString();
          // The authorization URL contains a public client ID and one-time state,
          // never an authorization code, client secret, or access/refresh token.
          // stderr leaves stdout exclusively available to the MCP transport.
          console.error(`Open this URL to authorize QuickBooks:\n${authUri}`);
          try {
            await open(authUri);
          } catch {
            console.error('Could not open a browser. Open the authorization URL manually.');
          }
        } catch {
          server.close();
          reject(new Error('Could not create the QuickBooks authorization request.'));
        }
      });
    });
  }

  private reauthError(): Error {
    return new Error(
      'QuickBooks authorization is invalid or expired and cannot be renewed automatically in ' +
      'production. Run npm run auth with a registered HTTPS callback (see README Authentication), ' +
      'then restart the server. For an HTTP 401, also verify ' +
      'QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET.'
    );
  }

  /** The SDK sometimes exposes only an HTTP status in its message. */
  private isAuthInvalidation(error: unknown): boolean {
    let current: unknown = error;
    for (let depth = 0; depth < 4 && current != null; depth++) {
      const e = current as {
        error?: unknown; error_description?: unknown; message?: unknown;
        status?: unknown; response?: { status?: unknown };
        authResponse?: { status?: unknown; response?: { status?: unknown }; json?: unknown };
        cause?: unknown;
      };
      const description = [typeof current === 'string' ? current : undefined, e.error, e.error_description, e.message, e.authResponse?.json]
        .filter(value => typeof value === 'string').join(' ');
      if (/invalid_grant/i.test(description)) return true;
      let status: unknown = e.status ?? e.response?.status ?? e.authResponse?.response?.status;
      if (status == null) {
        try {
          const authStatus = e.authResponse?.status;
          status = typeof authStatus === 'function' ? authStatus.call(e.authResponse) : authStatus;
        } catch { /* fall through to the SDK's HTTP status message */ }
      }
      const numericStatus = Number(status);
      const resolvedStatus = Number.isInteger(numericStatus) && numericStatus >= 100
        ? numericStatus : Number(description.match(/status code (\d{3})\b/i)?.[1]);
      if (resolvedStatus === 400 || resolvedStatus === 401) return true;
      current = e.cause;
    }
    return false;
  }

  /** Refresh the access token. Single-flight so concurrent callers don't race the rotating refresh token. */
  async refreshAccessToken(): Promise<RefreshResult> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<RefreshResult> {
    await this.ensureAuthorized();
    let response;
    try {
      response = await this.oauthClient.refreshUsingToken(this.refreshToken!);
    } catch (firstError) {
      let error = firstError;
      if (this.isAuthInvalidation(error)) {
        // Only reread after rejection: a valid in-memory token must not be
        // replaced by an older disk token after a temporary outage.
        const latest = this.store.load();
        if (latest.refresh_token && latest.refresh_token !== this.refreshToken &&
            latest.realm_id === this.realmId) {
          this.refreshToken = latest.refresh_token;
          try {
            response = await this.oauthClient.refreshUsingToken(this.refreshToken);
          } catch (retryError) {
            error = retryError;
          }
        }
      }
      if (!response) {
        if (!this.isAuthInvalidation(error)) {
          // Do not expose SDK error objects/messages; some embed credentials.
          throw new Error('Failed to refresh Quickbooks token. The request failed; retry later.');
        }
        if (this.environment === 'production') throw this.reauthError();
        if (!this.autoReauth) {
          throw new Error('QuickBooks refresh token is invalid or expired. Run `npm run auth` to re-authorize.');
        }
        console.error('QuickBooks refresh token rejected. Starting browser re-authorization.');
        this.refreshToken = undefined;
        this.realmId = undefined;
        this.accessToken = undefined;
        this.accessTokenExpiry = undefined;
        await this.ensureAuthorized();
        try {
          response = await this.oauthClient.refreshUsingToken(this.refreshToken!);
        } catch {
          throw new Error('Failed to refresh Quickbooks token after re-authorization. Check the app configuration.');
        }
      }
    }
    return this.applyRefresh(response);
  }

  private applyRefresh(authResponse: {
    token: { access_token: string; refresh_token?: string; expires_in: number; x_refresh_token_expires_in?: number };
  }): RefreshResult {
    const accessToken = authResponse.token.access_token;
    this.accessToken = accessToken;

    // Intuit rotates the refresh token roughly once every 24h (not on every call)
    // and forces the previous value to expire, so persist any new value we receive.
    const rotated = authResponse.token.refresh_token;
    if (rotated && rotated !== this.refreshToken) {
      this.refreshToken = rotated;
    }

    const expiresIn = authResponse.token.expires_in || 3600;
    this.accessTokenExpiry = new Date(Date.now() + expiresIn * 1000);
    try {
      this.persistTokens();
    } catch {
      // The refreshed token remains usable in this process. Retry persistence on
      // the next refresh, even if Intuit does not rotate the token again.
      console.error('Could not persist QuickBooks tokens. Check JSON token-store permissions before restarting.');
    }
    const refreshExpiresIn = authResponse.token.x_refresh_token_expires_in;
    if (typeof refreshExpiresIn === 'number' && refreshExpiresIn < 14 * 24 * 3600) {
      const hint = this.environment === 'production'
        ? 'Run npm run auth using the README Authentication instructions.'
        : 'Run npm run auth to renew authorization.';
      console.error(`QuickBooks refresh token expires in about ${Math.round(refreshExpiresIn / 86400)} days. ${hint}`);
    }

    return { access_token: accessToken, expires_in: expiresIn };
  }

  /** Ensure we hold a refresh token + realm, launching the browser flow if not. */
  private async ensureAuthorized(): Promise<void> {
    if (this.refreshToken && this.realmId) {
      return;
    }
    if (this.environment === 'production') throw this.reauthError();
    if (!this.autoReauth) {
      throw new Error('QuickBooks is not authorized. Run `npm run auth` to connect your company.');
    }
    await this.startOAuthFlow();
    if (!this.refreshToken || !this.realmId) {
      throw new Error('Failed to obtain required tokens from OAuth flow');
    }
  }

  async authenticate(): Promise<QuickBooks> {
    if (!this.authPromise) {
      this.authPromise = this.authenticateOnce().finally(() => {
        this.authPromise = undefined;
      });
    }
    return this.authPromise;
  }

  private async authenticateOnce(): Promise<QuickBooks> {
    await this.ensureAuthorized();

    // Refresh ahead of the real expiry so a token never dies mid-request.
    const expired =
      !this.accessToken ||
      !this.accessTokenExpiry ||
      this.accessTokenExpiry.getTime() - EXPIRY_SKEW_MS <= Date.now();
    if (expired) {
      await this.refreshAccessToken();
    }

    const accessToken = this.accessToken;
    if (!accessToken) {
      throw new Error('Failed to obtain a QuickBooks access token');
    }

    // Rebuild the node-quickbooks client only when the access token actually changed.
    if (!this.quickbooksInstance || this.builtForAccessToken !== accessToken) {
      this.quickbooksInstance = new QuickBooks(
        this.clientId,
        this.clientSecret,
        accessToken,
        false, // no token secret for OAuth 2.0
        this.realmId!, // ensured non-null by ensureAuthorized()
        this.environment === 'sandbox', // use the sandbox?
        false, // debug?
        null, // minor version
        '2.0', // oauth version
        this.refreshToken
      );
      this.builtForAccessToken = accessToken;
    }

    return this.quickbooksInstance;
  }

  static async getInstance(): Promise<QuickBooks> {
    return quickbooksClient.authenticate();
  }

  static async getAuthCredentials(): Promise<{ accessToken: string; realmId: string; isSandbox: boolean }> {
    await quickbooksClient.authenticate();
    return {
      accessToken: quickbooksClient.accessToken!,
      realmId: quickbooksClient.realmId!,
      isSandbox: quickbooksClient.environment === 'sandbox',
    };
  }

  getQuickbooks(): QuickBooks {
    if (!this.quickbooksInstance) {
      throw new Error('Quickbooks not authenticated. Call authenticate() first');
    }
    return this.quickbooksInstance;
  }
}

export const quickbooksClient = new QuickbooksClient({
  clientId: client_id,
  clientSecret: client_secret,
  environment,
  redirectUri: redirect_uri,
  store: new TokenStore(TOKEN_STORE_PATH),
});
