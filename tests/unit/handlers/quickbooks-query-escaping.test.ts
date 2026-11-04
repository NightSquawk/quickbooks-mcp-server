import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createRequire } from 'node:module';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';

// Exercise the actual vendored client and query builder. Replacing Axios's
// adapter keeps the request construction intact and prevents network access.
const require = createRequire(import.meta.url);
const QuickBooks = require('node-quickbooks');
const axios = require('axios') as { defaults: { adapter: AxiosAdapter } };
let requests: InternalAxiosRequestConfig[];

beforeEach(() => {
  requests = [];
  jest.replaceProperty(axios.defaults, 'adapter', async (config: InternalAxiosRequestConfig) => {
    requests.push(config);
    return {
      config, status: 200, statusText: 'OK', headers: {},
      data: { QueryResponse: { Customer: [], maxResults: 0 } },
    };
  });
});

afterEach(() => jest.restoreAllMocks());

async function customerQuery(criteria: unknown): Promise<string> {
  const client = new QuickBooks('test-key', 'test-secret', 'test-token', null, '123', true, false, 75, '2.0');
  await new Promise<void>((resolve, reject) => {
    client.findCustomers(criteria, (error: unknown) => error ? reject(error) : resolve());
  });
  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe('get');
  return new URL(requests[0].url!).searchParams.get('query')!;
}

describe('QuickBooks query string literal escaping', () => {
  it.each([
    ["O'Brien", String.raw`O\'Brien`],
    ['C:\\Clients\\', String.raw`C:\\Clients\\`],
    [String.raw`\' or Active = true`, String.raw`\\\' or Active = true`],
    [String.raw`\\' and Balance > 0`, String.raw`\\\\\' and Balance > 0`],
  ])('keeps scalar value %j inside one quoted literal', async (value, escaped) => {
    const query = await customerQuery({ DisplayName: value });
    expect(query).toBe(`select * from customer where DisplayName = '${escaped}' startposition 1 maxresults 1000`);
  });

  it('escapes each string in an IN list and retains punctuation after URL decoding', async () => {
    const query = await customerQuery([
      { field: 'DisplayName', operator: 'IN', value: [String.raw`\' or Active = true`, "O'Brien", 'A&B+100%#'] },
    ]);
    expect(query).toBe(String.raw`select * from customer where DisplayName IN ('\\\' or Active = true','O\'Brien','A&B+100%#') startposition 1 maxresults 1000`);
  });

  it('preserves numeric and boolean criteria without quoting them', async () => {
    const query = await customerQuery({ Active: false, Balance: 0, limit: 20, offset: 3 });
    expect(query).toBe('select * from customer where Active = false and Balance = 0 startposition 3 maxresults 20');
  });
});
