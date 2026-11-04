import dotenv from "dotenv";
import QuickBooks from "node-quickbooks";
import OAuthClient from "intuit-oauth";
import http from 'http';
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
const redirect_uri = 'http://localhost:8000/callback';

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

class QuickbooksClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly environment: string;
  private readonly redirectUri: string;
  private readonly store: TokenStore;
  private readonly oauthClient: OAuthClient;

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

  constructor(config: {
    clientId: string;
    clientSecret: string;
    environment: string;
    redirectUri: string;
    store: TokenStore;
  }) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.environment = config.environment;
    this.redirectUri = config.redirectUri;
    this.store = config.store;

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
    const port = 8000;
    return new Promise((resolve, reject) => {
      const server = http.createServer(async (req, res) => {
        if (!req.url?.startsWith('/callback')) {
          return;
        }
        try {
          const response = await this.oauthClient.createToken(req.url);
          const tokens = response.token;
          this.refreshToken = tokens.refresh_token;
          this.realmId = tokens.realmId;
          // A fresh authorization invalidates any previously cached access token.
          this.accessToken = undefined;
          this.accessTokenExpiry = undefined;
          this.persistTokens();

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(SUCCESS_HTML);
          setTimeout(() => {
            server.close();
            resolve();
          }, 1000);
        } catch (error) {
          console.error('Error during token creation:', error);
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(ERROR_HTML);
          server.close();
          reject(error);
        }
      });

      server.listen(port, async () => {
        const authUri = this.oauthClient
          .authorizeUri({ scope: [OAuthClient.scopes.Accounting as string], state: 'testState' })
          .toString();
        await open(authUri);
      });

      server.on('error', (error) => {
        console.error('Server error:', error);
        reject(error);
      });
    });
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

    try {
      return this.applyRefresh(await this.oauthClient.refreshUsingToken(this.refreshToken!));
    } catch (error: any) {
      const status = error?.authResponse?.response?.status ?? error?.response?.status;
      const body = error?.authResponse?.json ?? error?.originalMessage ?? error?.message ?? '';
      const isInvalidGrant =
        status === 400 ||
        /invalid_grant/i.test(typeof body === 'string' ? body : JSON.stringify(body));

      if (!isInvalidGrant) {
        throw new Error(`Failed to refresh Quickbooks token: ${error.message}`);
      }

      // The refresh token is dead (expired or revoked). Re-mint one via the browser
      // flow instead of forcing manual surgery — or fail fast if auto-reauth is off.
      if (!AUTO_REAUTH) {
        throw new Error(
          'QuickBooks refresh token is invalid or expired. Run `npm run auth` to re-authorize.'
        );
      }
      console.error('Refresh token rejected by Intuit — launching browser re-authorization flow.');
      this.refreshToken = undefined;
      this.realmId = undefined;
      await this.ensureAuthorized();
      return this.applyRefresh(await this.oauthClient.refreshUsingToken(this.refreshToken!));
    }
  }

  private applyRefresh(authResponse: {
    token: { access_token: string; refresh_token?: string; expires_in: number };
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
    this.persistTokens();

    return { access_token: accessToken, expires_in: expiresIn };
  }

  /** Ensure we hold a refresh token + realm, launching the browser flow if not. */
  private async ensureAuthorized(): Promise<void> {
    if (this.refreshToken && this.realmId) {
      return;
    }
    if (!AUTO_REAUTH) {
      throw new Error('QuickBooks is not authorized. Run `npm run auth` to connect your company.');
    }
    await this.startOAuthFlow();
    if (!this.refreshToken || !this.realmId) {
      throw new Error('Failed to obtain required tokens from OAuth flow');
    }
  }

  async authenticate(): Promise<QuickBooks> {
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
  store: new TokenStore(path.join(PROJECT_ROOT, '.qbo-tokens.json')),
});
