import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  mockQuickbooksClient,
  mockQuickbooksClientClass,
  mockQuickBooksInstance,
  resetAllMocks,
} from '../../mocks/quickbooks.mock';

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'schema-regression-test', version: '1.0.0' });
const restrictionVars = ['QUICKBOOKS_DISABLE_WRITE', 'QUICKBOOKS_DISABLE_UPDATE', 'QUICKBOOKS_DISABLE_DELETE'];
const originalRestrictions = restrictionVars.map(name => process.env[name]);

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  QuickbooksClient: mockQuickbooksClientClass,
  quickbooksClient: mockQuickbooksClient,
}));
// Use the real production server and registration. Only replace its transport
// so the MCP client can inspect schemas and call tools without opening stdio.
jest.unstable_mockModule('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: function () { return serverTransport; },
}));

beforeAll(async () => {
  restrictionVars.forEach(name => delete process.env[name]);
  await import('../../../src/index');
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await serverTransport.close();
  restrictionVars.forEach((name, index) => {
    const original = originalRestrictions[index];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  });
});

beforeEach(() => {
  resetAllMocks();
  mockQuickBooksInstance.findAccounts.mockImplementation((_criteria: any, cb: any) => cb(null, { QueryResponse: { Account: [] } }));
  mockQuickBooksInstance.findItems.mockImplementation((_criteria: any, cb: any) => cb(null, { QueryResponse: { Item: [] } }));
  mockQuickBooksInstance.findInvoices.mockImplementation((_criteria: any, cb: any) => cb(null, { QueryResponse: { Invoice: [] } }));
});

describe('Zod schemas through the MCP protocol', () => {
  it('serializes all 160 production tool schemas through tools/list', async () => {
    const result = await client.listTools();
    const serialized = JSON.parse(JSON.stringify(result));
    expect(serialized.tools).toHaveLength(160);
    expect(new Set(serialized.tools.map((tool: any) => tool.name)).size).toBe(160);
    for (const tool of serialized.tools) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties.params.type).toBe('object');
    }
    const updateSchema = serialized.tools.find((tool: any) => tool.name === 'update_account').inputSchema;
    expect(updateSchema.properties.params.properties.patch.type).toBe('object');
  });

  it.each([
    ['update-account', 'UpdateAccountTool', 'account_id'],
    ['update-item', 'UpdateItemTool', 'item_id'],
    ['update-invoice', 'UpdateInvoiceTool', 'invoice_id'],
  ])('preserves arbitrary nested patch values in %s', async (file, exportName, idField) => {
    const tool = (await import(`../../../src/tools/${file}.tool`))[exportName];
    const input = {
      [idField]: '42',
      patch: { Name: 'Revised', Active: false, Amount: 0, ParentRef: { value: '7' }, Line: [{ Id: '1' }] },
    };
    expect(tool.schema.parse(input)).toEqual(input);
    expect(tool.schema.safeParse({ [idField]: '42', patch: [] }).success).toBe(false);
  });

  describe.each([
    ['search_accounts', 'findAccounts'],
    ['search_items', 'findItems'],
    ['search_invoices', 'findInvoices'],
  ] as const)('%s', (name, method) => {
    it.each([
      [{ Id: '1' }, { Id: '1' }],
      [[{ field: 'Id', value: '1', operator: '=' }], [{ field: 'Id', value: '1', operator: '=' }]],
      [
        { filters: [{ field: 'Id', value: '1' }], limit: 5 },
        [{ field: 'Id', value: '1', operator: undefined }, { field: 'limit', value: 5 }],
      ],
    ])('preserves supported criteria format %j', async (criteria, expected) => {
      const result = await client.callTool({ name, arguments: { params: { criteria } } });
      expect(result.isError).not.toBe(true);
      expect(mockQuickBooksInstance[method]).toHaveBeenCalledWith(expected, expect.any(Function));
    });

    it('rejects scalar criteria before querying QuickBooks', async () => {
      const result = await client.callTool({ name, arguments: { params: { criteria: 123 } } });
      expect(JSON.stringify(result)).toContain('Invalid criteria');
      expect(mockQuickBooksInstance[method]).not.toHaveBeenCalled();
    });
  });

  it('warns about unsupported parameters while stripping them before execution', async () => {
    const result = await client.callTool({
      name: 'search_accounts',
      arguments: { params: { criteria: { Id: '1' }, unsupported_filter: 'ignored' } },
    });
    expect((result.content as any[])[0].text).toContain('does not support this parameter: unsupported_filter');
    expect(mockQuickBooksInstance.findAccounts).toHaveBeenCalledWith({ Id: '1' }, expect.any(Function));
  });
});
