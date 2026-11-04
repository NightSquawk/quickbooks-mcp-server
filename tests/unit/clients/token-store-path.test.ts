import { jest } from '@jest/globals';
import path from 'path';

const STORE_PATH = path.resolve('test-volume', 'qbo-tokens.json');
process.env.QUICKBOOKS_CLIENT_ID = 'host-client-id';
process.env.QUICKBOOKS_CLIENT_SECRET = 'host-client-secret';
process.env.QUICKBOOKS_REFRESH_TOKEN = 'initial-token';
process.env.QUICKBOOKS_REALM_ID = '99999';
process.env.QUICKBOOKS_ENVIRONMENT = 'sandbox';
process.env.QUICKBOOKS_TOKEN_STORE_PATH = STORE_PATH;

const config = jest.fn();
jest.unstable_mockModule('dotenv', () => ({ default: { config } }));
const write = jest.fn();
const rename = jest.fn();
jest.unstable_mockModule('fs', () => ({ default: {
  readFileSync: jest.fn(() => JSON.stringify({ refresh_token: 'stored-token', realm_id: '99999' })),
  writeFileSync: write, renameSync: rename, mkdirSync: jest.fn(), unlinkSync: jest.fn(),
  lstatSync: jest.fn(() => ({ isSymbolicLink: () => false })),
} }));
const refresh = jest.fn(async (_token: string) => ({ token: {
  access_token: 'fresh-access', refresh_token: 'rotated-token', expires_in: 3600,
} }));
jest.unstable_mockModule('intuit-oauth', () => ({ default: class { refreshUsingToken = refresh; } }));
jest.unstable_mockModule('node-quickbooks', () => ({ default: class {} }));
jest.unstable_mockModule('open', () => ({ default: jest.fn() }));
const { quickbooksClient } = await import('../../../src/clients/quickbooks-client');

describe('configured JSON token store', () => {
  it('refreshes the JSON token and atomically writes only token fields to the configured path', async () => {
    await quickbooksClient.authenticate();
    expect(refresh).toHaveBeenCalledWith('stored-token');
    expect(rename).toHaveBeenCalledWith(expect.stringContaining(`${STORE_PATH}.tmp.`), STORE_PATH);
    const [, payload, options] = write.mock.calls[0];
    expect(JSON.parse(String(payload))).toEqual({ refresh_token: 'rotated-token', realm_id: '99999' });
    expect(options).toEqual(expect.objectContaining({ mode: 0o600 }));
    expect(String(payload)).not.toContain('host-client-secret');
  });

  it('rejects a relative configured path', async () => {
    jest.resetModules();
    process.env.QUICKBOOKS_TOKEN_STORE_PATH = 'relative/tokens.json';
    await expect(import('../../../src/clients/quickbooks-client')).rejects.toThrow(/absolute path/);
    process.env.QUICKBOOKS_TOKEN_STORE_PATH = STORE_PATH;
  });

  it('loads static credentials from module .env without changing explicit environment precedence', async () => {
    jest.resetModules();
    await import('../../../src/clients/quickbooks-client');
    expect(config).toHaveBeenCalledWith({ path: expect.stringMatching(/[/\\]\.env$/) });
    expect(config).not.toHaveBeenCalledWith(expect.objectContaining({ override: true }));
    expect(config).not.toHaveBeenCalledWith(expect.objectContaining({ path: STORE_PATH }));
  });
});
