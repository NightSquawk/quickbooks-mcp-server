import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { REPORT_CONFIGS } from '../../../src/helpers/report-configs';

const server = {
  tool: jest.fn<(...args: any[]) => void>(),
  connect: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
};

// Exercise actual startup registration without opening stdio or authenticating.
jest.unstable_mockModule('../../../src/server/qbo-mcp-server', () => ({
  QuickbooksMCPServer: { GetServer: () => server },
}));
jest.unstable_mockModule('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {},
}));
jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  QuickbooksClient: {},
  quickbooksClient: {},
}));

const restrictionVars = ['QUICKBOOKS_DISABLE_WRITE', 'QUICKBOOKS_DISABLE_UPDATE', 'QUICKBOOKS_DISABLE_DELETE'];
const originalRestrictions = restrictionVars.map(name => process.env[name]);

afterEach(() => {
  restrictionVars.forEach((name, index) => {
    const original = originalRestrictions[index];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  });
});

describe('startup registration after upstream integration', () => {
  it('exposes 160 unique tools, preserving all fork reports without upstream report duplicates', async () => {
    restrictionVars.forEach(name => delete process.env[name]);
    await import('../../../src/index');
    const names = server.tool.mock.calls.map(call => call[0]);
    expect(names).toHaveLength(160);
    expect(new Set(names).size).toBe(160);
    expect(names.filter(name => name.startsWith('report_')).sort())
      .toEqual(REPORT_CONFIGS.map(config => config.toolName).sort());
    expect(names).toEqual(expect.arrayContaining([
      'create_payment', 'create_attachable', 'get_invoice_pdf', 'search_budgets', 'get_preferences',
    ]));
    for (const name of [
      'get_balance_sheet', 'get_profit_and_loss', 'get_cash_flow', 'get_trial_balance',
      'get_general_ledger', 'get_customer_sales', 'get_aged_receivables', 'get_customer_balance',
      'get_aged_payables', 'get_vendor_expenses', 'get_vendor_balance',
    ]) {
      expect(names).not.toContain(name);
    }
    expect(server.connect).toHaveBeenCalledTimes(1);
  });
});
