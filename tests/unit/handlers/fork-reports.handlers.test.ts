import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import QuickBooks from 'node-quickbooks';
import { REPORT_CONFIGS } from '../../../src/helpers/report-configs';
import {
  mockQuickbooksClientClass,
  mockQuickBooksInstance,
  resetAllMocks,
} from '../../mocks/quickbooks.mock';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  QuickbooksClient: mockQuickbooksClientClass,
}));

const { runQuickbooksReport } = await import('../../../src/handlers/run-quickbooks-report.handler');
const { createReportTool } = await import('../../../src/helpers/report-handler-factory');

describe('preserved fork reports', () => {
  beforeEach(() => {
    resetAllMocks();
    mockQuickBooksInstance.reportBalanceSheet.mockImplementation((_params: any, cb: any) => cb(null, { Rows: [] }));
    mockQuickBooksInstance.reportProfitAndLoss.mockImplementation((_params: any, cb: any) => cb(null, { Rows: [] }));
  });

  it('retains 29 distinct report names backed by real SDK methods', () => {
    expect(REPORT_CONFIGS).toHaveLength(29);
    expect(new Set(REPORT_CONFIGS.map(config => config.toolName)).size).toBe(29);
    for (const config of REPORT_CONFIGS) {
      expect(config.toolName).toMatch(/^report_/);
      expect(typeof (QuickBooks.prototype as any)[config.methodName]).toBe('function');
    }
    expect(REPORT_CONFIGS.find(config => config.toolName === 'report_general_ledger')?.methodName)
      .toBe('reportGeneralLedgerDetail');
  });

  it('retains every parameter from the 11 replaced upstream report tools', async () => {
    for (const report of [
      'balance-sheet', 'profit-and-loss', 'cash-flow', 'trial-balance', 'general-ledger',
      'customer-sales', 'aged-receivables', 'customer-balance', 'aged-payables', 'vendor-expenses', 'vendor-balance',
    ]) {
      const exports = await import(`../../../src/tools/get-${report}.tool`);
      const upstreamTool = Object.values(exports)[0] as any;
      const config = REPORT_CONFIGS.find(entry => entry.toolName === upstreamTool.name.replace(/^get_/, 'report_'))!;
      expect(Object.keys(config.schema.shape)).toEqual(expect.arrayContaining(Object.keys(upstreamTool.schema.shape)));
    }
  });

  it('supplies year start for a Balance Sheet as-of date without modifying caller input', async () => {
    const options = { end_date: '2025-09-30', accounting_method: 'Accrual' };
    const result = await runQuickbooksReport('reportBalanceSheet', options);
    expect(mockQuickBooksInstance.reportBalanceSheet).toHaveBeenCalledWith(
      { ...options, start_date: '2025-01-01' }, expect.any(Function)
    );
    expect(options).toEqual({ end_date: '2025-09-30', accounting_method: 'Accrual' });
    expect(result).toEqual({ result: { Rows: [] }, isError: false, error: null });
  });

  it.each([
    { start_date: '2025-04-01', end_date: '2025-09-30' },
    { date_macro: 'This Fiscal Year' },
    { start_date: '2025-04-01' },
    {},
  ])('preserves explicit date ranges and macros: %j', async options => {
    await runQuickbooksReport('reportBalanceSheet', options);
    expect(mockQuickBooksInstance.reportBalanceSheet).toHaveBeenCalledWith(options, expect.any(Function));
  });

  it('does not synthesize start_date for other reports', async () => {
    await runQuickbooksReport('reportProfitAndLoss', { end_date: '2025-09-30' });
    expect(mockQuickBooksInstance.reportProfitAndLoss).toHaveBeenCalledWith(
      { end_date: '2025-09-30' }, expect.any(Function)
    );
  });

  it('retains Classes and the fork filters through the report schema and handler', async () => {
    const config = REPORT_CONFIGS.find(report => report.toolName === 'report_profit_and_loss')!;
    const params = config.schema.parse({
      date_macro: 'This Fiscal Year',
      summarize_column_by: 'Classes',
      accounting_method: 'Cash',
      class: '4',
      customer: '7',
    });
    const tool = createReportTool(config);
    const result = await (tool.handler as any)({ params });
    expect(mockQuickBooksInstance.reportProfitAndLoss).toHaveBeenCalledWith(params, expect.any(Function));
    expect(result.content[0].text).toBe(JSON.stringify({ Rows: [] }));
  });

  it('checks token freshness on every report invocation', async () => {
    await runQuickbooksReport('reportBalanceSheet', {});
    await runQuickbooksReport('reportBalanceSheet', {});
    expect(mockQuickbooksClientClass.getInstance).toHaveBeenCalledTimes(2);
  });

  it('omits empty values but preserves zero and false', async () => {
    await runQuickbooksReport('reportProfitAndLoss', {
      customer: '', vendor: null, department: undefined, num_periods: 0, custom_flag: false,
    });
    expect(mockQuickBooksInstance.reportProfitAndLoss).toHaveBeenCalledWith(
      { num_periods: 0, custom_flag: false }, expect.any(Function)
    );
  });

  it('reports API errors through the existing report tool', async () => {
    mockQuickBooksInstance.reportBalanceSheet.mockImplementation((_params: any, cb: any) => cb(new Error('Report unavailable'), null));
    const config = REPORT_CONFIGS.find(report => report.toolName === 'report_balance_sheet')!;
    const result = await (createReportTool(config).handler as any)({ params: {} });
    expect(result.content[0].text).toContain('Error running report_balance_sheet: Error: Report unavailable');
  });

  it('surfaces authentication failures without calling the report API', async () => {
    mockQuickbooksClientClass.getInstance.mockRejectedValueOnce(new Error('Authentication required'));
    const result = await runQuickbooksReport('reportBalanceSheet', {});
    expect(result).toEqual({ result: null, isError: true, error: 'Error: Authentication required' });
    expect(mockQuickBooksInstance.reportBalanceSheet).not.toHaveBeenCalled();
  });
});
