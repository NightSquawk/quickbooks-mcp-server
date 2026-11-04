import { QuickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

/**
 * Generic handler for all QuickBooks Online report endpoints.
 * Authenticates, calls the specified report method on the node-quickbooks client,
 * and returns the raw report JSON.
 *
 * @param methodName - The node-quickbooks method name (e.g. "reportBalanceSheet")
 * @param options - Key-value pairs passed as query parameters to the QBO Reports API
 */
export async function runQuickbooksReport(
  methodName: string,
  options: Record<string, any>
): Promise<ToolResponse<any>> {
  try {
    const qb = await QuickbooksClient.getInstance();

    // Strip undefined/null/empty values — QBO API rejects empty params
    const cleanOptions: Record<string, any> = {};
    for (const [k, v] of Object.entries(options)) {
      if (v !== undefined && v !== null && v !== "") {
        cleanOptions[k] = v;
      }
    }

    // QBO can ignore a Balance Sheet end_date without a start_date. Preserve
    // explicit ranges and date macros; supply the upstream year-start fallback
    // only for an otherwise standalone end_date.
    if (
      methodName === "reportBalanceSheet" &&
      typeof cleanOptions.end_date === "string" &&
      !cleanOptions.start_date &&
      !cleanOptions.date_macro
    ) {
      cleanOptions.start_date = `${cleanOptions.end_date.substring(0, 4)}-01-01`;
    }

    return new Promise((resolve) => {
      (qb as any)[methodName](cleanOptions, (err: any, report: any) => {
        if (err) {
          resolve({ result: null, isError: true, error: formatError(err) });
        } else {
          resolve({ result: report, isError: false, error: null });
        }
      });
    });
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
}
