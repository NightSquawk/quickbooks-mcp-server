import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RegisterTool } from "./register-tool.js";
import { createReportTool } from "./report-handler-factory.js";
import { REPORT_CONFIGS } from "./report-configs.js";

/**
 * Known report method names on the node-quickbooks QuickBooks prototype.
 * Used for boot-time validation to catch config typos at startup
 * instead of at call time ("method is not a function").
 *
 * getQuickbooks() isn't available pre-auth, so we validate against
 * this static list derived from node-quickbooks v2.0.43+ source.
 */
const KNOWN_REPORT_METHODS = new Set([
  "reportBalanceSheet",
  "reportProfitAndLoss",
  "reportProfitAndLossDetail",
  "reportTrialBalance",
  "reportTrialBalanceFR",
  "reportCashFlow",
  "reportInventoryValuationSummary",
  "reportCustomerSales",
  "reportItemSales",
  "reportCustomerIncome",
  "reportCustomerBalance",
  "reportCustomerBalanceDetail",
  "reportAgedReceivables",
  "reportAgedReceivableDetail",
  "reportVendorBalance",
  "reportVendorBalanceDetail",
  "reportAgedPayables",
  "reportAgedPayableDetail",
  "reportVendorExpenses",
  "reportTransactionList",
  "reportTransactionListWithSplits",
  "reportTransactionListByCustomer",
  "reportTransactionListByVendor",
  "reportGeneralLedgerDetail",
  "reportTaxSummary",
  "reportDepartmentSales",
  "reportClassSales",
  "reportAccountListDetail",
  "reportJournalReport",
]);

/**
 * Registers all 29 QuickBooks report tools with the MCP server.
 * Validates each config's methodName at boot time to catch typos early.
 */
export function registerAllReportTools(server: McpServer): void {
  for (const config of REPORT_CONFIGS) {
    if (!KNOWN_REPORT_METHODS.has(config.methodName)) {
      throw new Error(
        `Invalid report config: methodName "${config.methodName}" for tool "${config.toolName}" ` +
        `is not a known node-quickbooks report method.`
      );
    }
    RegisterTool(server, createReportTool(config));
  }
}
