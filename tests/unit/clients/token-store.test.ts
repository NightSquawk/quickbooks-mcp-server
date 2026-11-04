/** Adapted from upstream's env-store tests to the fork's atomic JSON store. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TokenStore } from '../../../src/clients/token-store';

let directory: string;
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qbo-token-test-')); });
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

it('stores only rotating tokens, persists across instances, and creates private directories/files', () => {
  const filename = path.join(directory, 'tenant', 'tokens.json');
  new TokenStore(filename).save({ refresh_token: 'test-refresh', realm_id: '12345' });
  expect(new TokenStore(filename).load()).toEqual({ refresh_token: 'test-refresh', realm_id: '12345' });
  if (process.platform !== 'win32') {
    expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(filename)).mode & 0o777).toBe(0o700);
  }
  expect(fs.readdirSync(path.dirname(filename))).toEqual(['tokens.json']);
});

it('merges a rotated token without losing the company identifier', () => {
  const store = new TokenStore(path.join(directory, 'tokens.json'));
  store.save({ refresh_token: 'old', realm_id: '12345' });
  store.save({ refresh_token: 'new' });
  expect(store.load()).toEqual({ refresh_token: 'new', realm_id: '12345' });
});

it.each(['null', '42', 'invalid json', '{"refresh_token":42,"realm_id":false}'])(
  'does not treat invalid token data %s as credentials', contents => {
    const filename = path.join(directory, 'tokens.json');
    fs.writeFileSync(filename, contents);
    const tokens = new TokenStore(filename).load();
    expect(tokens.refresh_token).toBeUndefined();
    expect(tokens.realm_id).toBeUndefined();
  },
);

it('reads missing files as an empty store for legacy-token migration', () => {
  expect(new TokenStore(path.join(directory, 'missing.json')).load()).toEqual({});
});

// Exercise real file symlinks on both CI platforms, including dangling targets.
it.each([true, false])('preserves a symlink and atomically updates its target (existing=%s)', exists => {
  const target = path.join(directory, 'data', 'tokens.json');
  fs.mkdirSync(path.dirname(target));
  if (exists) fs.writeFileSync(target, '{"realm_id":"12345"}');
  const link = path.join(directory, 'token-link.json');
  fs.symlinkSync(path.join('data', 'tokens.json'), link, 'file');
  const store = new TokenStore(link);
  store.save({ refresh_token: 'new-token', realm_id: '12345' });
  expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ refresh_token: 'new-token', realm_id: '12345' });
  expect(fs.readdirSync(path.dirname(target))).toEqual(['tokens.json']);
});

it('does not expose filesystem details in persistence failures', () => {
  const file = path.join(directory, 'occupied');
  fs.writeFileSync(file, 'placeholder');
  expect(() => new TokenStore(path.join(file, 'tokens.json')).save({ refresh_token: 'private-value' }))
    .toThrow('Could not persist the QuickBooks JSON token store. Check its path and permissions.');
});
