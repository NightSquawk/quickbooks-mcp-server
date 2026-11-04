import { jest } from '@jest/globals';
import type { TokenStore } from '../../../src/clients/token-store';

process.env.QUICKBOOKS_CLIENT_ID = 'test-client-id';
process.env.QUICKBOOKS_CLIENT_SECRET = 'test-client-secret';
process.env.QUICKBOOKS_REFRESH_TOKEN = 'seed-refresh-token';
process.env.QUICKBOOKS_REALM_ID = '12345';
process.env.QUICKBOOKS_ENVIRONMENT = 'sandbox';
process.env.QBO_AUTO_REAUTH = 'true';
delete process.env.QUICKBOOKS_TOKEN_STORE_PATH;

jest.unstable_mockModule('dotenv', () => ({ default: { config: jest.fn() } }));
const refreshDispatch = jest.fn<(token: string) => Promise<unknown>>();
const openMock = jest.fn(async () => undefined);
const quickbooksConstruct = jest.fn();
jest.unstable_mockModule('intuit-oauth', () => ({
  default: class {
    static scopes = { Accounting: 'accounting' };
    refreshUsingToken = refreshDispatch;
    createToken = jest.fn();
    authorizeUri = jest.fn(() => 'https://mock');
  },
}));
jest.unstable_mockModule('node-quickbooks', () => ({
  default: class { constructor(...args: unknown[]) { quickbooksConstruct(...args); } },
}));
jest.unstable_mockModule('open', () => ({ default: openMock }));
jest.unstable_mockModule('http', () => ({ default: { createServer: jest.fn() } }));
type Tokens = { refresh_token?: string; realm_id?: string };
class MemoryStore {
  load = jest.fn<() => Tokens>(() => ({}));
  save = jest.fn<(tokens: Tokens) => Tokens>(tokens => tokens);
}
jest.unstable_mockModule('../../../src/clients/token-store', () => ({ TokenStore: MemoryStore }));
const { QuickbooksClient, quickbooksClient } = await import('../../../src/clients/quickbooks-client');

function makeClient(options: { environment?: string; token?: string; autoReauth?: boolean } = {}) {
  const store = new MemoryStore();
  store.load.mockReturnValue({ refresh_token: options.token ?? 'memory-token', realm_id: '12345' });
  const client = new QuickbooksClient({
    clientId: 'test-client-id', clientSecret: 'test-client-secret',
    environment: options.environment ?? 'sandbox', redirectUri: 'http://localhost:8000/callback',
    store: store as unknown as TokenStore, autoReauth: options.autoReauth ?? false,
  });
  store.load.mockClear();
  return { client, store };
}
const deadToken = (status = 400) => Object.assign(new Error(`Request failed with status code ${status}`), {
  error: `Request failed with status code ${status}`, error_description: '',
  authResponse: { response: '', status: () => undefined },
});
const success = (refresh_token?: string) => ({ token: { access_token: 'fresh-access', expires_in: 3600, refresh_token } });
const tokenOf = (client: unknown) => (client as { refreshToken?: string }).refreshToken;

beforeEach(() => { refreshDispatch.mockReset(); });

describe('JSON token-store rotation recovery', () => {
  it('keeps a working in-memory token when disk has an older value', async () => {
    const { client, store } = makeClient({ token: 'new-memory' });
    store.load.mockReturnValue({ refresh_token: 'old-disk', realm_id: '12345' });
    refreshDispatch.mockResolvedValue(success());
    await client.refreshAccessToken();
    expect(refreshDispatch).toHaveBeenCalledWith('new-memory');
    expect(store.load).not.toHaveBeenCalled();
  });

  it('retries with a sibling-rotated token only after rejection', async () => {
    const { client, store } = makeClient({ token: 'old-memory' });
    store.load.mockReturnValue({ refresh_token: 'new-disk', realm_id: '12345' });
    refreshDispatch.mockRejectedValueOnce(deadToken()).mockResolvedValueOnce(success('rotated-again'));
    await client.authenticate();
    expect(refreshDispatch.mock.calls).toEqual([['old-memory'], ['new-disk']]);
    expect(store.save).toHaveBeenLastCalledWith({ refresh_token: 'rotated-again', realm_id: '12345' });
  });

  it('does not replace a token or reread disk on a transient error', async () => {
    const { client, store } = makeClient({ token: 'still-valid' });
    refreshDispatch.mockRejectedValueOnce(deadToken(503));
    await expect(client.authenticate()).rejects.toThrow(/retry later/);
    expect(store.load).not.toHaveBeenCalled();
    expect(tokenOf(client)).toBe('still-valid');
    refreshDispatch.mockResolvedValueOnce(success());
    await expect(client.authenticate()).resolves.toBeDefined();
  });

  it('does not mix a different company token with the current realm', async () => {
    const { client, store } = makeClient();
    store.load.mockReturnValue({ refresh_token: 'other-company', realm_id: 'different-realm' });
    refreshDispatch.mockRejectedValue(deadToken());
    await expect(client.authenticate()).rejects.toThrow(/re-authorize/);
    expect(refreshDispatch).toHaveBeenCalledTimes(1);
  });

  it('stops retrying when the disk token is unchanged', async () => {
    const { client } = makeClient();
    refreshDispatch.mockRejectedValue(deadToken());
    await expect(client.authenticate()).rejects.toThrow(/re-authorize/);
    expect(refreshDispatch).toHaveBeenCalledTimes(1);
    expect(openMock).not.toHaveBeenCalled();
  });

  it('treats a transient failure on the sibling-token retry as retryable', async () => {
    const { client, store } = makeClient();
    store.load.mockReturnValue({ refresh_token: 'new-disk', realm_id: '12345' });
    refreshDispatch.mockRejectedValueOnce(deadToken()).mockRejectedValueOnce(deadToken(429));
    await expect(client.authenticate()).rejects.toThrow(/retry later/);
    expect(tokenOf(client)).toBe('new-disk');
    expect(openMock).not.toHaveBeenCalled();
  });

  it('retains valid tokens after a persistence failure and retries writing next refresh', async () => {
    const { client, store } = makeClient();
    const stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
    store.save.mockImplementationOnce(() => { throw new Error('sensitive-filesystem-data'); });
    refreshDispatch.mockResolvedValueOnce(success('new-token')).mockResolvedValueOnce(success());
    await client.authenticate();
    await client.refreshAccessToken();
    expect(refreshDispatch).toHaveBeenLastCalledWith('new-token');
    expect(store.save).toHaveBeenCalledTimes(2);
    expect(store.save).toHaveBeenLastCalledWith({ refresh_token: 'new-token', realm_id: '12345' });
    expect(JSON.stringify(stderr.mock.calls)).not.toContain('sensitive-filesystem-data');
  });
});

describe('production and SDK error handling', () => {
  it.each([
    ['400 message', deadToken()], ['401 message', deadToken(401)],
    ['explicit OAuth error', { error_description: 'invalid_grant' }],
    ['structured status', { response: { status: 400 } }],
    ['SDK status accessor', { authResponse: { status: () => 401 } }],
    ['nested cause', { cause: { cause: deadToken() } }],
  ])('fails with production guidance for %s', async (_name, error) => {
    const { client } = makeClient({ environment: 'production', autoReauth: true });
    refreshDispatch.mockRejectedValue(error);
    await expect(client.authenticate()).rejects.toThrow(/cannot be renewed automatically in production/);
    expect(openMock).not.toHaveBeenCalled();
  });

  it.each([503, 429])('preserves authorization on HTTP %s', async status => {
    const { client } = makeClient({ environment: 'production', autoReauth: true });
    refreshDispatch.mockRejectedValue(deadToken(status));
    await expect(client.authenticate()).rejects.toThrow(/retry later/);
    expect(tokenOf(client)).toBe('memory-token');
    expect(openMock).not.toHaveBeenCalled();
  });

  it('does not expose SDK error content through a public error or its cause', async () => {
    const { client } = makeClient();
    refreshDispatch.mockRejectedValue(Object.assign(new Error('secret-access-token'), { config: { secret: 'private' } }));
    const error = await client.authenticate().catch(value => value);
    expect(error.message).not.toMatch(/secret-access-token|private/);
    expect(error.cause).toBeUndefined();
  });

  it('does not open a production browser flow when no token exists', async () => {
    const { client } = makeClient({ environment: 'production', token: '', autoReauth: true });
    await expect(client.authenticate()).rejects.toThrow(/cannot be renewed automatically in production/);
    expect(refreshDispatch).not.toHaveBeenCalled();
    expect(openMock).not.toHaveBeenCalled();
  });

  it('honors disabled auto-reauth for an unconnected sandbox', async () => {
    const { client } = makeClient({ token: '', autoReauth: false });
    await expect(client.authenticate()).rejects.toThrow(/npm run auth/);
    expect(openMock).not.toHaveBeenCalled();
  });

  it('allows production refresh while the token remains valid', async () => {
    const { client } = makeClient({ environment: 'production' });
    refreshDispatch.mockResolvedValue(success());
    await expect(client.authenticate()).resolves.toBeDefined();
    expect(openMock).not.toHaveBeenCalled();
  });
});

describe('concurrent requests and upstream client API', () => {
  it('shares refresh among concurrent requests and reuses a client until its token changes', async () => {
    const { client } = makeClient();
    refreshDispatch.mockResolvedValue(success());
    const clients = await Promise.all([client.authenticate(), client.authenticate(), client.authenticate()]);
    expect(refreshDispatch).toHaveBeenCalledTimes(1);
    expect(quickbooksConstruct).toHaveBeenCalledTimes(1);
    expect(clients[0]).toBe(clients[1]);
    expect(await client.authenticate()).toBe(clients[0]);
  });

  it('makes static handler and upload interfaces share the authenticated singleton', async () => {
    refreshDispatch.mockResolvedValue(success());
    const [client, credentials] = await Promise.all([
      QuickbooksClient.getInstance(), QuickbooksClient.getAuthCredentials(),
    ]);
    expect(client).toBe(quickbooksClient.getQuickbooks());
    expect(credentials).toEqual({ accessToken: 'fresh-access', realmId: '12345', isSandbox: true });
    expect(refreshDispatch).toHaveBeenCalledTimes(1);
  });
});
