import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mockQuickbooksClientClass, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';

jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  QuickbooksClient: mockQuickbooksClientClass,
}));

const cases = [
  ['payment', 'UpdatePaymentTool', 'updatePayment', { private_note: 'PrivateNote' }],
  ['credit-memo', 'UpdateCreditMemoTool', 'updateCreditMemo', { private_note: 'PrivateNote', doc_number: 'DocNumber' }],
  ['sales-receipt', 'UpdateSalesReceiptTool', 'updateSalesReceipt', { private_note: 'PrivateNote', doc_number: 'DocNumber' }],
  ['refund-receipt', 'UpdateRefundReceiptTool', 'updateRefundReceipt', { private_note: 'PrivateNote', doc_number: 'DocNumber' }],
  ['purchase-order', 'UpdatePurchaseOrderTool', 'updatePurchaseOrder', { private_note: 'PrivateNote', doc_number: 'DocNumber' }],
  ['vendor-credit', 'UpdateVendorCreditTool', 'updateVendorCredit', { private_note: 'PrivateNote' }],
  ['deposit', 'UpdateDepositTool', 'updateDeposit', { private_note: 'PrivateNote' }],
  ['transfer', 'UpdateTransferTool', 'updateTransfer', { private_note: 'PrivateNote' }],
  ['time-activity', 'UpdateTimeActivityTool', 'updateTimeActivity', { description: 'Description' }],
] as const;

beforeEach(() => {
  resetAllMocks();
  mockQuickBooksInstance.getDeposit.mockImplementation((_id: any, cb: any) => cb(null, {
    Id: '42', SyncToken: '8', PrivateNote: 'existing note', DepositToAccountRef: { value: 'bank-1' },
  }));
});

describe.each(cases)('update_%s text fields', (file, exportName, method, fields) => {
  it.each([undefined, '', 'replacement'])('distinguishes omitted, cleared, and replaced text: %j', async value => {
    const update = mockQuickBooksInstance[method];
    update.mockImplementation((payload: any, cb: any) => cb(null, payload));
    const tool = (await import(`../../../src/tools/update-${file}.tool`))[exportName];
    const input: Record<string, unknown> = { id: '42', sync_token: '9' };
    if (value !== undefined) {
      for (const key of Object.keys(fields)) input[key] = value;
    }
    // Exercise the public schema and tool handler, including the accepted empty
    // string that previously became a successful sparse no-op.
    const params = tool.schema.parse(input);
    const result = await tool.handler({ params });
    expect(result.content[0].text).not.toMatch(/^Error/);
    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({ Id: '42', SyncToken: '9' });
    for (const field of Object.values(fields)) {
      if (value !== undefined) expect(payload[field]).toBe(value);
      else if (file === 'deposit') expect(payload[field]).toBe('existing note');
      else expect(payload).not.toHaveProperty(field);
    }
    if (file === 'deposit') expect(payload.DepositToAccountRef).toEqual({ value: 'bank-1' });
  });
});
