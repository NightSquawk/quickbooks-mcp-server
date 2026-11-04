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
    const invoiceSchema = serialized.tools.find((tool: any) => tool.name === 'create_invoice').inputSchema;
    const invoiceLine = invoiceSchema.properties.params.properties.line_items.items;
    expect(invoiceLine.additionalProperties).toBe(false);
    expect(invoiceLine.properties.tax_code_ref.description).toContain('Tax code for this line');
    const vendorSchema = serialized.tools.find((tool: any) => tool.name === 'search_vendors').inputSchema;
    expect(vendorSchema.properties.params.properties.criteria.description).toContain('Filters to apply');
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

  it('reports an unsupported invoice line field with its path before any financial write', async () => {
    const result = await client.callTool({
      name: 'create_invoice',
      arguments: { params: { customer_ref: '1', line_items: [{ item_ref: '2', qty: 1, unit_price: 25, class_ref: '3' }] } },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('class_ref');
    expect(JSON.stringify(result)).toContain('line_items');
    expect(mockQuickBooksInstance.createInvoice).not.toHaveBeenCalled();
  });

  it('preserves supported invoice line values and rejects invalid declared values', async () => {
    mockQuickBooksInstance.createInvoice.mockImplementation((invoice: any, cb: any) => cb(null, invoice));
    const params = {
      customer_ref: '1',
      line_items: [{ item_ref: '2', qty: 2, unit_price: 25, tax_code_ref: 'TAX', service_date: '2026-11-04' }],
    };
    const result = await client.callTool({ name: 'create_invoice', arguments: { params } });
    expect(result.isError).not.toBe(true);
    expect(mockQuickBooksInstance.createInvoice).toHaveBeenCalledWith(expect.objectContaining({
      Line: [expect.objectContaining({ Amount: 50, SalesItemLineDetail: expect.objectContaining({
        ItemRef: { value: '2' }, Qty: 2, UnitPrice: 25, TaxCodeRef: { value: 'TAX' }, ServiceDate: '2026-11-04',
      }) })],
    }), expect.any(Function));
    mockQuickBooksInstance.createInvoice.mockClear();
    const invalid = await client.callTool({ name: 'create_invoice', arguments: { params: {
      ...params, line_items: [{ ...params.line_items[0], qty: 'two' }],
    } } });
    expect(invalid.isError).toBe(true);
    expect(mockQuickBooksInstance.createInvoice).not.toHaveBeenCalled();
  });

  it('preserves arbitrary nested patch records through the registered MCP tool', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, { Id: '42', SyncToken: '1' }));
    mockQuickBooksInstance.updateInvoice.mockImplementation((invoice: any, cb: any) => cb(null, invoice));
    const patch = { PrivateNote: 'Updated', CustomField: [{ DefinitionId: '1', StringValue: 'custom' }] };
    const result = await client.callTool({ name: 'update_invoice', arguments: { params: { invoice_id: '42', patch } } });
    expect(result.isError).not.toBe(true);
    expect(mockQuickBooksInstance.updateInvoice).toHaveBeenCalledWith(expect.objectContaining(patch), expect.any(Function));
    expect(JSON.stringify(result)).not.toContain('WARNING');
  });
});
