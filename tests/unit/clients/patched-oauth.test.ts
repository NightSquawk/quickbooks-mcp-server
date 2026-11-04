import { jest } from '@jest/globals';
import { createRequire } from 'node:module';
import type OAuthClientType from '../../../vendor/intuit-oauth';

// Load the real CommonJS SDK. Only its HTTP boundary is replaced below.
const require = createRequire(import.meta.url);
const OAuthClient = require('../../../vendor/intuit-oauth') as typeof OAuthClientType;

function setup() {
  const client = new OAuthClient({
    environment: 'sandbox',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    redirectUri: 'http://localhost:8000/callback',
  });
  const http = jest.spyOn(client, 'loadResponse').mockResolvedValue({
    status: 200,
    headers: { intuit_tid: 'test-tid' },
    data: {
      token_type: 'bearer',
      access_token: 'test-access',
      refresh_token: 'test-refresh',
      expires_in: 3600,
      x_refresh_token_expires_in: 86400,
    },
  });
  return { client, http };
}

describe('vendored intuit-oauth native query parsing', () => {
  it('keeps CommonJS exports and excludes the vulnerable decoder dependency chain', () => {
    const manifest = require('../../../vendor/intuit-oauth/package.json');
    expect(typeof OAuthClient).toBe('function');
    expect(manifest).toMatchObject({ name: 'intuit-oauth', version: '4.2.5-nst.1', type: 'commonjs' });
    expect(manifest.dependencies).not.toHaveProperty('query-string');
    expect(manifest.dependencies).not.toHaveProperty('decode-uri-component');
    expect(manifest).not.toHaveProperty('scripts');
  });

  it('encodes authorization URLs without changing spaces, punctuation, field order, or scope arrays', () => {
    const { client, http } = setup();
    client.clientId = 'client +/雪';
    client.redirectUri = 'http://localhost:8000/callback?next=/a b&x=1';

    expect(client.authorizeUri({ scope: ['openid', 'profile'], state: "state !'()*~+&=雪" })).toBe(
      'https://appcenter.intuit.com/connect/oauth2?client_id=client%20%2B%2F%E9%9B%AA'
      + '&redirect_uri=http%3A%2F%2Flocalhost%3A8000%2Fcallback%3Fnext%3D%2Fa%20b%26x%3D1'
      + '&response_type=code&scope=openid%20profile'
      + '&state=state%20%21%27%28%29%2A~%2B%26%3D%E9%9B%AA',
    );
    expect(http).not.toHaveBeenCalled();
  });

  it('omits undefined configuration and retains null as a bare key instead of a literal string', () => {
    const { client } = setup();
    Object.assign(client, { clientId: undefined, redirectUri: null });
    expect(client.authorizeUri({ scope: 'openid', state: 'fixed' })).toBe(
      'https://appcenter.intuit.com/connect/oauth2?redirect_uri&response_type=code&scope=openid&state=fixed',
    );
  });

  it('generates a nonempty state when omitted and still rejects missing scopes', () => {
    const { client } = setup();
    const first = new URL(client.authorizeUri({ scope: 'openid' })).searchParams.get('state');
    const second = new URL(client.authorizeUri({ scope: 'openid' })).searchParams.get('state');
    expect(first).toEqual(expect.any(String));
    expect(first?.length).toBeGreaterThan(0);
    expect(second).not.toBe(first);
    expect(() => client.authorizeUri({ scope: '' })).toThrow('Provide the scopes');
  });

  it.each(['http://localhost:8000/callback?', '?', ''])(
    'exchanges a callback with prefix %j and preserves decoded token metadata',
    async (prefix) => {
      const { client, http } = setup();
      const response = await client.createToken(
        prefix + 'code=a%2Bb%26c%3Dd%25%E9%9B%AA&realmId=00123&state=space+plus%2B'
        + '&redirectUri=http%3A%2F%2Flocalhost%3A8000%2Fcallback%3Fx%3D1',
      );
      expect(http).toHaveBeenCalledTimes(1);
      expect(http).toHaveBeenCalledWith(expect.objectContaining({
        url: OAuthClient.tokenEndpoint,
        method: 'POST',
        data: {
          grant_type: 'authorization_code',
          code: 'a+b&c=d%雪',
          redirect_uri: 'http://localhost:8000/callback?x=1',
        },
        headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      }));
      expect(client.token.realmId).toBe('00123');
      expect(client.token.state).toBe('space plus+');
      expect(response.getToken()).toMatchObject({
        realmId: '00123', access_token: 'test-access', refresh_token: 'test-refresh',
      });
    },
  );

  it('uses the configured redirect URI when the callback does not provide one', async () => {
    const { client, http } = setup();
    await client.createToken('code=abc');
    expect(http.mock.calls[0][0].data.redirect_uri).toBe('http://localhost:8000/callback');
    expect(client.token.realmId).toBe('');
  });

  it('preserves repeated keys as ordered arrays, including bare and empty values', async () => {
    const { client, http } = setup();
    await client.createToken('code=first&code=second&realmId=1&realmId=2&state&state=&state=last');
    expect(http.mock.calls[0][0].data.code).toEqual(['first', 'second']);
    expect(client.token.realmId).toEqual(['1', '2']);
    expect(client.token.state).toEqual([null, '', 'last']);
  });

  it.each([
    ['code=abc&state', null],
    ['code=abc&state=', ''],
    ['code=abc', undefined],
  ])('distinguishes missing, bare, and empty state for %s', async (query, expected) => {
    const { client } = setup();
    await client.createToken(query);
    expect(client.token.state).toBe(expected);
  });

  it.each([
    ['%E0%A4%A', '\uFFFD%A'],
    ['%C0%AF', '\uFFFD\uFFFD'],
    ['%FF%GG%', '\uFFFD%GG%'],
    ['%25E0%25A4%25A', '%E0%A4%A'],
  ])('decodes malformed input %s once using native URL semantics', async (encoded, expected) => {
    const { client, http } = setup();
    await client.createToken(`code=${encoded}&state=${encoded}`);
    expect(http.mock.calls[0][0].data.code).toBe(expected);
    expect(client.token.state).toBe(expected);
  });

  it('handles a long malformed callback without the recursive decoder', async () => {
    const { client, http } = setup();
    await client.createToken(`code=${'%FF'.repeat(4096)}`);
    expect(http.mock.calls[0][0].data.code).toBe('\uFFFD'.repeat(4096));
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('does not treat prototype keys as callback fields or mutate global prototypes', async () => {
    const { client, http } = setup();
    await client.createToken('code=abc&__proto__=polluted&constructor=ignored&toString=ignored');
    expect(http.mock.calls[0][0].data.code).toBe('abc');
    expect(client.token.realmId).toBe('');
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('retains whitespace and repeated-separator parsing behavior', async () => {
    const { client, http } = setup();
    await client.createToken('  &code=abc&&state=ok&  ');
    expect(http.mock.calls[0][0].data.code).toBe('abc');
    expect(client.token.state).toBe('ok');
  });

  it('rejects an empty callback before attempting any HTTP request', async () => {
    const { client, http } = setup();
    await expect(client.createToken('')).rejects.toThrow('Provide the Uri');
    expect(http).not.toHaveBeenCalled();
  });

  it('retains token endpoint failure handling without storing a token', async () => {
    const { client, http } = setup();
    http.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 400'), {
      response: {
        status: 400,
        headers: { intuit_tid: 'failed-tid' },
        data: { error: 'invalid_grant', error_description: 'Authorization code expired' },
      },
    }));
    await expect(client.createToken('code=expired&state=expected')).rejects.toMatchObject({
      error: 'invalid_grant',
      error_description: 'Authorization code expired',
    });
    expect(client.token.access_token).toBe('');
    expect(http).toHaveBeenCalledTimes(1);
  });
});
