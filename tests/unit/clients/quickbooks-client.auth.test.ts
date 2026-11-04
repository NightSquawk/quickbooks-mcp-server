/**
 * Behavioral tests for QuickbooksClient authentication recovery.
 *
 * Covers two failure modes that previously made `npm run auth` (and any MCP
 * call) fail hard with no way to recover except hand-editing .env:
 *
 * 1. authenticate() must fall back to the interactive OAuth flow when the
 *    stored refresh token is rejected (e.g. invalid_grant after the token
 *    was rotated by another consumer, expired past the 100-day window, or
 *    was revoked).
 * 2. The interactive flow must authorize AND exchange with the localhost
 *    callback redirect, even when QUICKBOOKS_REDIRECT_URI points elsewhere
 *    (e.g. the OAuth playground). Intuit rejects the code exchange if the
 *    redirect_uri differs from the one used in the authorize request.
 */
import { jest } from '@jest/globals';

// The module under test validates env at import time. Set deterministic
// values before importing it. QUICKBOOKS_REDIRECT_URI deliberately points
// away from localhost to prove the flow ignores it.
process.env.QUICKBOOKS_CLIENT_ID = 'test-client-id';
process.env.QUICKBOOKS_CLIENT_SECRET = 'test-client-secret';
process.env.QUICKBOOKS_REFRESH_TOKEN = 'stale-refresh-token';
process.env.QUICKBOOKS_REALM_ID = '12345';
process.env.QUICKBOOKS_ENVIRONMENT = 'sandbox';
process.env.QBO_AUTO_REAUTH = 'true';
delete process.env.QUICKBOOKS_TOKEN_STORE_PATH;
process.env.QUICKBOOKS_REDIRECT_URI = 'https://developer.intuit.com/v2/OAuth2Playground/RedirectUrl';

// Mock dotenv to a no-op so the module under test never loads the real .env.
// dotenv's internal CommonJS require('fs') bypasses the ESM fs mock below, so
// without this dotenv.config({override:true}) would clobber the env values set
// above with whatever the real .env holds (e.g. QUICKBOOKS_ENVIRONMENT).
jest.unstable_mockModule('dotenv', () => ({ default: { config: jest.fn(), parse: jest.fn(() => ({})) } }));

// Track every OAuthClient the module constructs so tests can tell the
// module-level client (env redirect) apart from the flow client (localhost).
type MockOAuth = {
  cfg: Record<string, unknown>;
  refreshUsingToken: jest.Mock;
  createToken: jest.Mock;
  authorizeUri: jest.Mock;
};
const oauthInstances: MockOAuth[] = [];
// Shared dispatch points so tests can program responses without caring which
// instance receives the call.
const refreshDispatch = jest.fn<(token: string) => Promise<unknown>>();
const createTokenDispatch = jest.fn<(url: string) => Promise<unknown>>();

jest.unstable_mockModule('intuit-oauth', () => {
  class MockOAuthClient {
    static scopes = { Accounting: 'com.intuit.quickbooks.accounting' };
    cfg: Record<string, unknown>;
    refreshUsingToken = jest.fn((token: string) => refreshDispatch(token));
    createToken = jest.fn((url: string) => createTokenDispatch(url));
    authorizeUri = jest.fn(() => 'https://appcenter.intuit.com/connect/oauth2?mock');
    constructor(cfg: Record<string, unknown>) {
      this.cfg = cfg;
      oauthInstances.push(this as unknown as MockOAuth);
    }
  }
  return { default: MockOAuthClient };
});

jest.unstable_mockModule('node-quickbooks', () => ({
  default: class MockQuickBooks {
    constructor(..._args: unknown[]) {}
  },
}));

const openMock = jest.fn<() => Promise<void>>(async () => undefined);
jest.unstable_mockModule('open', () => ({ default: openMock }));

// Capture the OAuth callback handler instead of binding a real port, and
// stub fs so tests never touch a real token store.
let callbackHandler:
  | ((req: { url?: string; method?: string }, res: { writeHead: jest.Mock; end: jest.Mock }) => Promise<void>)
  | undefined;
const fakeServer = {
  listen: jest.fn((_port: unknown, _host: unknown, cb?: () => void) => {
    if (cb) cb();
    return fakeServer;
  }),
  close: jest.fn(),
  on: jest.fn(),
  address: jest.fn(() => ({ address: '::', port: 8000, family: 'IPv6' })),
};
jest.unstable_mockModule('http', () => ({
  default: {
    createServer: jest.fn((handler: typeof callbackHandler) => {
      callbackHandler = handler;
      return fakeServer;
    }),
  },
}));

const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
jest.unstable_mockModule('fs', () => ({
  default: {
    readFileSync: jest.fn(() => {
      throw enoent();
    }),
    existsSync: jest.fn(() => false),
    writeFileSync: jest.fn(),
    renameSync: jest.fn(),
    unlinkSync: jest.fn(),
    mkdirSync: jest.fn(),
    lstatSync: jest.fn(() => { throw enoent(); }),
  },
}));

const { QuickbooksClient, quickbooksClient } = await import('../../../src/clients/quickbooks-client');
const { TokenStore } = await import('../../../src/clients/token-store');

// Polls until the OAuth callback handler has been registered by startOAuthFlow.
async function untilCallbackRegistered(timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!callbackHandler) {
    if (Date.now() - start > timeoutMs) throw new Error('OAuth callback handler never registered');
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// Poll separately for authorizeUri() so this helper remains valid if the
// listen mock later becomes asynchronous.
async function untilAuthorizeUriCalled(client: MockOAuth, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (client.authorizeUri.mock.calls.length === 0) {
    if (Date.now() - start > timeoutMs) throw new Error('authorizeUri() was never called');
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('QuickbooksClient.authenticate', () => {
  it('refreshes silently without starting the interactive flow when the refresh token works', async () => {
    refreshDispatch.mockResolvedValueOnce({
      token: { access_token: 'access-1', expires_in: 3600, refresh_token: 'rotated-1' },
    });

    await quickbooksClient.authenticate();

    // Only the module-level client exists; no flow client was constructed.
    expect(oauthInstances).toHaveLength(1);
    expect(oauthInstances[0].cfg.redirectUri).toBe(process.env.QUICKBOOKS_REDIRECT_URI);
    expect(callbackHandler).toBeUndefined();
  });

  it('falls back to the interactive OAuth flow when the refresh token is rejected, and uses the localhost redirect', async () => {
    // Force the next authenticate() to attempt a refresh.
    (quickbooksClient as unknown as { accessTokenExpiry?: Date }).accessTokenExpiry = new Date(0);

    refreshDispatch
      // The stored token is dead.
      .mockRejectedValueOnce(new Error('invalid_grant'))
      // After the interactive flow hands us a new one, refresh succeeds.
      .mockResolvedValueOnce({
        token: { access_token: 'access-2', expires_in: 3600, refresh_token: 'rotated-2' },
      });
    createTokenDispatch.mockResolvedValueOnce({
      token: { refresh_token: 'flow-refresh-token', realmId: '12345' },
    });

    const authPromise = quickbooksClient.authenticate();

    await untilCallbackRegistered();

    // A second OAuthClient was constructed for the flow, with the localhost
    // redirect (NOT the playground URI from the environment).
    expect(oauthInstances).toHaveLength(2);
    const flowClient = oauthInstances[1];
    expect(flowClient.cfg.redirectUri).toBe('http://localhost:8000/callback');

    // The state actually used is a random per-run value, not a fixed literal —
    // read it off the authorizeUri() call so the simulated callback matches it.
    await untilAuthorizeUriCalled(flowClient);
    const { state } = (flowClient.authorizeUri.mock.calls[0][0] as { state: string; scope: string[] });
    expect(state).toEqual(expect.stringMatching(/^[0-9a-f]{48}$/));

    // Simulate the user completing authorization in the browser: Intuit
    // redirects to the local callback server with that same state echoed back.
    const res = { writeHead: jest.fn(), end: jest.fn() };
    await callbackHandler!({ url: `/callback?code=abc&state=${state}`, method: 'GET' }, res);

    await authPromise;

    // The code exchange went through the flow client, so authorize and
    // exchange used the same redirect_uri.
    expect(flowClient.createToken).toHaveBeenCalledWith(`/callback?code=abc&state=${state}`);
    expect(oauthInstances[0].createToken).not.toHaveBeenCalled();

    // The flow's new refresh token was then exchanged for an access token.
    expect(refreshDispatch).toHaveBeenLastCalledWith('flow-refresh-token');
    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/html' });
  }, 15000);

  it('rejects a callback whose state does not match the one from this run\'s authorize request', async () => {
    // Force the next authenticate() to attempt a refresh, same setup as above.
    (quickbooksClient as unknown as { accessTokenExpiry?: Date }).accessTokenExpiry = new Date(0);
    refreshDispatch.mockRejectedValueOnce(new Error('invalid_grant'));
    // Reset so untilCallbackRegistered() below waits for THIS run's handler
    // rather than immediately observing the previous test's leftover value.
    callbackHandler = undefined;

    // Don't await — the flow is left waiting for a (never-arriving) valid callback.
    const authPromise = quickbooksClient.authenticate();

    await untilCallbackRegistered();

    // Someone hitting the callback with a guessed/spoofed or stale state —
    // e.g. a replayed URL, or another concurrent auth attempt — must be
    // rejected with 400, and the code must never reach createToken().
    const res = { writeHead: jest.fn(), end: jest.fn() };
    await callbackHandler!({ url: '/callback?code=abc&state=not-the-real-state', method: 'GET' }, res);

    expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'text/plain' });
    expect(createTokenDispatch).not.toHaveBeenCalled();

    // Rejected input did not consume the one-shot exchange or strand the flow.
    const flowClient = oauthInstances[oauthInstances.length - 1];
    const { state } = flowClient.authorizeUri.mock.calls[0][0] as { state: string };
    createTokenDispatch.mockResolvedValueOnce({ token: { refresh_token: 'recovered', realmId: '12345' } });
    refreshDispatch.mockResolvedValueOnce({ token: { access_token: 'recovered-access', expires_in: 3600 } });
    await callbackHandler!({ url: `/callback?code=valid&state=${state}`, method: 'GET' }, res);
    await authPromise;
  });
});


describe('OAuth callback and MCP transport safety', () => {
  it('exchanges a code once even when a duplicate callback arrives while the first is pending', async () => {
    const stdout = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
    callbackHandler = undefined;
    let finishExchange!: (value: unknown) => void;
    createTokenDispatch.mockImplementationOnce(() => new Promise(resolve => { finishExchange = resolve; }));
    const flowPromise = quickbooksClient.startOAuthFlow();
    await untilCallbackRegistered();
    const flowClient = oauthInstances[oauthInstances.length - 1];
    const { state } = flowClient.authorizeUri.mock.calls[0][0] as { state: string };
    const url = `/callback?code=private-code&state=${state}`;
    const response = () => ({ writeHead: jest.fn(), end: jest.fn() });
    const first = callbackHandler!({ url, method: 'GET' }, response());
    await callbackHandler!({ url, method: 'GET' }, response());
    expect(createTokenDispatch).toHaveBeenCalledTimes(1);
    finishExchange({ token: { refresh_token: 'private-refresh', realmId: '12345' } });
    await first;
    await flowPromise;
    expect(stdout).not.toHaveBeenCalled();
    expect(JSON.stringify(stderr.mock.calls)).not.toMatch(/private-code|private-refresh|test-client-secret/);
  });

  it('reports unrelated paths without exchanging a code, then accepts the valid callback', async () => {
    callbackHandler = undefined;
    const flowPromise = quickbooksClient.startOAuthFlow();
    await untilCallbackRegistered();
    const res = { writeHead: jest.fn(), end: jest.fn() };
    await callbackHandler!({ url: '/callback-extra?code=bad', method: 'GET' }, res);
    expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'text/plain' });
    expect(createTokenDispatch).not.toHaveBeenCalled();
    const flowClient = oauthInstances[oauthInstances.length - 1];
    const { state } = flowClient.authorizeUri.mock.calls[0][0] as { state: string };
    createTokenDispatch.mockResolvedValueOnce({ token: { refresh_token: 'flow-token', realmId: '12345' } });
    await callbackHandler!({ url: `/callback?code=ok&state=${state}` }, res);
    await flowPromise;
  });
});


describe('explicit production authorization', () => {
  it('uses the registered HTTPS callback for explicit authorization while auto-reauth is disabled', async () => {
    const client = new QuickbooksClient({
      clientId: 'test-client-id', clientSecret: 'test-client-secret', environment: 'production',
      redirectUri: 'https://auth.example.com/callback', store: new TokenStore('/unused-test-store.json'),
      autoReauth: false,
    });
    callbackHandler = undefined;
    const flowPromise = client.startOAuthFlow();
    await untilCallbackRegistered();
    const flowClient = oauthInstances[oauthInstances.length - 1];
    expect(flowClient.cfg.redirectUri).toBe('https://auth.example.com/callback');
    const { state } = flowClient.authorizeUri.mock.calls[0][0] as { state: string };
    createTokenDispatch.mockResolvedValueOnce({ token: { refresh_token: 'prod-refresh', realmId: '12345' } });
    await callbackHandler!({ url: `/callback?code=ok&state=${state}` }, { writeHead: jest.fn(), end: jest.fn() });
    await flowPromise;
  });

  it('rejects an explicit production flow without a configured HTTPS callback', async () => {
    const client = new QuickbooksClient({
      clientId: 'test-client-id', clientSecret: 'test-client-secret', environment: 'production',
      redirectUri: 'http://localhost:8000/callback', store: new TokenStore('/unused-test-store.json'),
    });
    callbackHandler = undefined;
    await expect(client.startOAuthFlow()).rejects.toThrow(/registered HTTPS/);
    expect(callbackHandler).toBeUndefined();
  });
});


describe('headless and failed authorization', () => {
  it('continues waiting for a callback when browser launch fails and ignores malformed input', async () => {
    openMock.mockRejectedValueOnce(new Error('browser unavailable'));
    const stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
    callbackHandler = undefined;
    const flowPromise = quickbooksClient.startOAuthFlow();
    await untilCallbackRegistered();
    const res = { writeHead: jest.fn(), end: jest.fn() };
    await callbackHandler!({ url: 'http://[' }, res);
    expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'text/plain' });
    expect(createTokenDispatch).not.toHaveBeenCalled();
    const flowClient = oauthInstances[oauthInstances.length - 1];
    const { state } = flowClient.authorizeUri.mock.calls[0][0] as { state: string };
    createTokenDispatch.mockResolvedValueOnce({ token: { refresh_token: 'headless-token', realmId: '12345' } });
    await callbackHandler!({ url: `/callback?code=ok&state=${state}` }, res);
    await flowPromise;
    expect(JSON.stringify(stderr.mock.calls)).toContain('Open the authorization URL manually');
  });

  it('redacts SDK error data on a failed code exchange', async () => {
    const stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
    const stdout = jest.spyOn(console, 'log').mockImplementation(() => {});
    callbackHandler = undefined;
    const flowPromise = quickbooksClient.startOAuthFlow();
    const result = flowPromise.catch(error => error);
    await untilCallbackRegistered();
    const flowClient = oauthInstances[oauthInstances.length - 1];
    const { state } = flowClient.authorizeUri.mock.calls[0][0] as { state: string };
    createTokenDispatch.mockRejectedValueOnce(new Error('private-refresh-token'));
    const res = { writeHead: jest.fn(), end: jest.fn() };
    await callbackHandler!({ url: `/callback?code=private-code&state=${state}` }, res);
    const error = await result;
    expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'text/html' });
    expect(error.message).not.toMatch(/private-refresh-token|private-code/);
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(stderr.mock.calls)).not.toMatch(/private-refresh-token|private-code/);
    expect(stdout).not.toHaveBeenCalled();
  });
});


it('canonicalizes malformed percent sequences and removes unknown callback fields before SDK decoding', async () => {
  callbackHandler = undefined;
  const flowPromise = quickbooksClient.startOAuthFlow();
  await untilCallbackRegistered();
  const flowClient = oauthInstances[oauthInstances.length - 1];
  const { state } = flowClient.authorizeUri.mock.calls[0][0] as { state: string };
  createTokenDispatch.mockResolvedValueOnce({ token: { refresh_token: 'encoded-callback-token', realmId: '12345' } });
  const raw = `/callback?code=%E0%A4%A&state=${state}&realmId=12345&unknown=%C0`;
  await callbackHandler!({ url: raw }, { writeHead: jest.fn(), end: jest.fn() });
  await flowPromise;
  const handedToSdk = String(createTokenDispatch.mock.calls[0][0]);
  expect(handedToSdk).not.toBe(raw);
  expect(handedToSdk).not.toContain('unknown=');
  expect(() => decodeURIComponent(handedToSdk)).not.toThrow();
  const canonical = new URL(handedToSdk, 'http://localhost:8000');
  expect(canonical.searchParams.get('code')).toBe(new URL(raw, 'http://localhost:8000').searchParams.get('code'));
  expect(canonical.searchParams.get('state')).toBe(state);
  expect(canonical.searchParams.get('realmId')).toBe('12345');
});
