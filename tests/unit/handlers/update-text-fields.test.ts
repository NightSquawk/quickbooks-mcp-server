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
  ['attachable', 'UpdateAttachableTool', 'updateAttachable', { note: 'Note', category: 'Category', file_name: 'FileName', content_type: 'ContentType' }],
  ['class', 'UpdateClassTool', 'updateClass', { name: 'Name' }],
  ['department', 'UpdateDepartmentTool', 'updateDepartment', { name: 'Name' }],
  ['term', 'UpdateTermTool', 'updateTerm', { name: 'Name' }],
  ['payment-method', 'UpdatePaymentMethodTool', 'updatePaymentMethod', { name: 'Name' }],
  ['company-info', 'UpdateCompanyInfoTool', 'updateCompanyInfo', {
    company_name: 'CompanyName', legal_name: 'LegalName', primary_phone: 'PrimaryPhone.FreeFormNumber',
    email: 'Email.Address', web_addr: 'WebAddr.URI',
  }],
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
      if (value !== undefined) expect(payload).toHaveProperty(field, value);
      else if (file === 'deposit') expect(payload[field]).toBe('existing note');
      else expect(payload).not.toHaveProperty(field);
    }
    if (file === 'deposit') expect(payload.DepositToAccountRef).toEqual({ value: 'bank-1' });
  });
});

it.each([undefined, '', 'replacement'])('preserves explicitly supplied company address text: %j', async value => {
  const { UpdateCompanyInfoTool: tool } = await import('../../../src/tools/update-company-info.tool');
  mockQuickBooksInstance.updateCompanyInfo.mockImplementation((payload: any, cb: any) => cb(null, payload));
  const input: Record<string, unknown> = { id: '42', sync_token: '9' };
  const fields = {
    line1: 'Line1', city: 'City', country_sub_division_code: 'CountrySubDivisionCode',
    postal_code: 'PostalCode', country: 'Country',
  };
  if (value !== undefined) input.company_addr = Object.fromEntries(Object.keys(fields).map(key => [key, value]));

  const result = await tool.handler({ params: tool.schema.parse(input) });

  expect(result.content[0].text).not.toMatch(/^Error/);
  expect(mockQuickBooksInstance.updateCompanyInfo).toHaveBeenCalledTimes(1);
  const payload: any = mockQuickBooksInstance.updateCompanyInfo.mock.calls[0][0];
  if (value === undefined) expect(payload).not.toHaveProperty('CompanyAddr');
  else expect(payload.CompanyAddr).toEqual(Object.fromEntries(Object.values(fields).map(key => [key, value])));
});

it('honors explicitly empty attachment metadata instead of deriving it from file_path', async () => {
  const { UpdateAttachableTool: tool } = await import('../../../src/tools/update-attachable.tool');
  mockQuickBooksInstance.updateAttachable.mockImplementation((payload: any, cb: any) => cb(null, payload));

  const result = await tool.handler({ params: tool.schema.parse({
    id: '42', sync_token: '9', file_path: '/not-read/receipt.pdf', file_name: '', content_type: '',
  }) });

  expect(result.content[0].text).not.toMatch(/^Error/);
  expect(mockQuickBooksInstance.updateAttachable.mock.calls[0][0]).toMatchObject({ FileName: '', ContentType: '' });
});
