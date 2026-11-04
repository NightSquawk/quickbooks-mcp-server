import { QuickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

/** Void an invoice while preserving its transaction record. */
export async function deleteQuickbooksInvoice(idOrEntity: any): Promise<ToolResponse<any>> {
  try {
    const quickbooks = await QuickbooksClient.getInstance();
    return await new Promise((resolve) => {
      // The legacy tool name is delete_invoice, but its documented operation is
      // void. The SDK fetches the current invoice/SyncToken when given an ID.
      (quickbooks as any).voidInvoice(idOrEntity, (err: any, response: any) => {
        resolve(err
          ? { result: null, isError: true, error: formatError(err) }
          : { result: response, isError: false, error: null });
      });
    });
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
