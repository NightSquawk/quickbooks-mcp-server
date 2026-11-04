import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createRequire } from 'node:module';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';

const require = createRequire(import.meta.url);
const QuickBooks = require('node-quickbooks');
const axios = require('axios') as { defaults: { adapter: AxiosAdapter } };
const originalAdapter = axios.defaults.adapter;
const getInstance = jest.fn<() => Promise<any>>();
jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  QuickbooksClient: { getInstance },
}));
const { deleteQuickbooksInvoice } = await import('../../../src/handlers/delete-quickbooks-invoice.handler');
const { DeleteInvoiceTool } = await import('../../../src/tools/delete-invoice.tool');

let requests: InternalAxiosRequestConfig[];
const invoice = { Id: '42', SyncToken: '7', TotalAmt: 120 };
beforeEach(() => {
  requests = [];
  getInstance.mockResolvedValue(new QuickBooks('key', 'secret', 'token', null, '123', true, false, 75, '2.0'));
  axios.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    requests.push(config);
    return {
      config, status: 200, statusText: 'OK', headers: {},
      data: { Invoice: config.method === 'get' ? invoice : { ...invoice, TotalAmt: 0 } },
    };
  };
});
afterEach(() => { axios.defaults.adapter = originalAdapter; });

describe('legacy delete_invoice tool performs a void operation', () => {
  it.each(['42', invoice])('sends operation=void for %j without a delete request', async input => {
    const result = await deleteQuickbooksInvoice(input);
    expect(result.isError).toBe(false);
    expect(result.result.Invoice.TotalAmt).toBe(0);
    const writes = requests.filter(request => request.method === 'post');
    expect(writes).toHaveLength(1);
    expect(new URL(writes[0].url!).searchParams.get('operation')).toBe('void');
    expect(JSON.parse(writes[0].data)).toMatchObject({ Id: '42', SyncToken: '7' });
    expect(requests.some(request => new URL(request.url!).searchParams.get('operation') === 'delete')).toBe(false);
    expect(requests.filter(request => request.method === 'get')).toHaveLength(typeof input === 'string' ? 1 : 0);
  });

  it('reports a failed void without attempting another mutation', async () => {
    axios.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      requests.push(config);
      throw new Error('void request failed');
    };
    await expect(deleteQuickbooksInvoice(invoice)).resolves.toMatchObject({ result: null, isError: true });
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url!).searchParams.get('operation')).toBe('void');
  });

  it('converts synchronous SDK failures into the tool error contract', async () => {
    getInstance.mockResolvedValueOnce({ voidInvoice: () => { throw new Error('invalid invoice'); } });
    await expect(deleteQuickbooksInvoice(invoice)).resolves.toMatchObject({ result: null, isError: true });
    expect(requests).toHaveLength(0);
  });

  it('describes a void and reports the completed void to MCP callers', async () => {
    expect(DeleteInvoiceTool.description).toMatch(/^Void an invoice/);
    const result = await DeleteInvoiceTool.handler({ params: { idOrEntity: invoice } });
    expect(result.content[0].text).toBe('Invoice voided:');
  });
});
