import { ReportConfig } from "../types/report-config.js";
import {
  dateRangeSchema,
  agingSchema,
  accountingMethodSchema,
  summarizeSchema,
  filtersSchema,
  detailExtrasSchema,
} from "./report-schemas.js";

/**
 * All 29 QuickBooks Online report configurations.
 * Single source of truth for tool names, descriptions, method names, and schemas.
 *
 * Schema composition follows the QBO API docs — each report gets only the
 * parameter groups it actually supports.
 */
export const REPORT_CONFIGS: ReportConfig[] = [
  // ── Financial Statements ──────────────────────────────────────────────────

  {
    toolName: "report_balance_sheet",
    description:
      "Run a Balance Sheet report showing assets, liabilities, and equity. " +
      "Supports date range, accounting method, summarization, and filters.",
    methodName: "reportBalanceSheet",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(summarizeSchema)
      .merge(filtersSchema),
  },
  {
    toolName: "report_profit_and_loss",
    description:
      "Run a Profit and Loss (Income Statement) summary report showing income, " +
      "expenses, and net profit over a period. Supports date range, accounting method, " +
      "summarization, and filters.",
    methodName: "reportProfitAndLoss",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(summarizeSchema)
      .merge(filtersSchema),
  },
  {
    toolName: "report_profit_and_loss_detail",
    description:
      "Run a detailed Profit and Loss report showing individual transactions. " +
      "WARNING: Large date ranges may produce very large responses — use 1-3 month ranges. " +
      "Supports date range, accounting method, summarization, filters, and detail extras.",
    methodName: "reportProfitAndLossDetail",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(summarizeSchema)
      .merge(filtersSchema)
      .merge(detailExtrasSchema),
  },
  {
    toolName: "report_trial_balance",
    description:
      "Run a Trial Balance report showing debit and credit balances for all accounts. " +
      "Supports date range, accounting method, summarization, and filters.",
    methodName: "reportTrialBalance",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(summarizeSchema)
      .merge(filtersSchema),
  },
  {
    toolName: "report_cash_flow",
    description:
      "Run a Statement of Cash Flows report showing operating, investing, and financing activities. " +
      "Supports date range, accounting method, summarization, and filters.",
    methodName: "reportCashFlow",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(summarizeSchema)
      .merge(filtersSchema),
  },

  // ── France-specific ────────────────────────────────────────────────────────

  {
    toolName: "report_trial_balance_fr",
    description:
      "Run a Trial Balance report for France-based companies. " +
      "Only available for French company files — will error on non-French companies.",
    methodName: "reportTrialBalanceFR",
    schema: dateRangeSchema.merge(accountingMethodSchema),
  },
  {
    toolName: "report_tax_summary",
    description:
      "Run a Tax Summary report. Only available for France-based companies — " +
      "will error on non-French companies.",
    methodName: "reportTaxSummary",
    schema: dateRangeSchema.merge(accountingMethodSchema),
  },

  // ── Inventory ──────────────────────────────────────────────────────────────

  {
    toolName: "report_inventory_valuation_summary",
    description:
      "Run an Inventory Valuation Summary report showing quantity, cost, and value of inventory items. " +
      "Supports date range and summarization.",
    methodName: "reportInventoryValuationSummary",
    schema: dateRangeSchema.merge(summarizeSchema),
  },

  // ── Sales / Income ─────────────────────────────────────────────────────────

  {
    toolName: "report_customer_sales",
    description:
      "Run a Sales by Customer Summary report. " +
      "Supports date range, accounting method, summarization, and filters.",
    methodName: "reportCustomerSales",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(summarizeSchema)
      .merge(filtersSchema),
  },
  {
    toolName: "report_item_sales",
    description:
      "Run a Sales by Product/Service Summary report. " +
      "Supports date range, accounting method, summarization, and filters.",
    methodName: "reportItemSales",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(summarizeSchema)
      .merge(filtersSchema),
  },
  {
    toolName: "report_customer_income",
    description:
      "Run an Income by Customer Summary report. " +
      "Supports date range, accounting method, summarization, and filters.",
    methodName: "reportCustomerIncome",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(summarizeSchema)
      .merge(filtersSchema),
  },
  {
    toolName: "report_department_sales",
    description:
      "Run a Sales by Department Summary report. Requires departments to be enabled. " +
      "Supports date range, accounting method, summarization, and filters.",
    methodName: "reportDepartmentSales",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(summarizeSchema)
      .merge(filtersSchema),
  },
  {
    toolName: "report_class_sales",
    description:
      "Run a Sales by Class Summary report. Requires classes to be enabled. " +
      "Supports date range, accounting method, summarization, and filters.",
    methodName: "reportClassSales",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(summarizeSchema)
      .merge(filtersSchema),
  },

  // ── Customer Balance ───────────────────────────────────────────────────────

  {
    toolName: "report_customer_balance",
    description:
      "Run a Customer Balance Summary report showing outstanding balances by customer. " +
      "Supports date range, accounting method, and filters.",
    methodName: "reportCustomerBalance",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(filtersSchema),
  },
  {
    toolName: "report_customer_balance_detail",
    description:
      "Run a Customer Balance Detail report showing individual open transactions per customer. " +
      "Supports date range, accounting method, and filters.",
    methodName: "reportCustomerBalanceDetail",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(filtersSchema),
  },

  // ── A/R Aging ──────────────────────────────────────────────────────────────

  {
    toolName: "report_aged_receivables",
    description:
      "Run an Accounts Receivable Aging Summary report showing outstanding customer balances " +
      "grouped by aging period. Uses report_date (not start_date/end_date).",
    methodName: "reportAgedReceivables",
    schema: agingSchema
      .merge(accountingMethodSchema)
      .merge(filtersSchema),
  },
  {
    toolName: "report_aged_receivable_detail",
    description:
      "Run an Accounts Receivable Aging Detail report showing individual open invoices " +
      "grouped by aging period. Uses report_date (not start_date/end_date).",
    methodName: "reportAgedReceivableDetail",
    schema: agingSchema
      .merge(accountingMethodSchema)
      .merge(filtersSchema),
  },

  // ── Vendor Balance ─────────────────────────────────────────────────────────

  {
    toolName: "report_vendor_balance",
    description:
      "Run a Vendor Balance Summary report showing outstanding balances by vendor. " +
      "Supports date range, accounting method, and filters.",
    methodName: "reportVendorBalance",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(filtersSchema),
  },
  {
    toolName: "report_vendor_balance_detail",
    description:
      "Run a Vendor Balance Detail report showing individual open bills per vendor. " +
      "Supports date range, accounting method, and filters.",
    methodName: "reportVendorBalanceDetail",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(filtersSchema),
  },

  // ── A/P Aging ──────────────────────────────────────────────────────────────

  {
    toolName: "report_aged_payables",
    description:
      "Run an Accounts Payable Aging Summary report showing outstanding vendor balances " +
      "grouped by aging period. Uses report_date (not start_date/end_date).",
    methodName: "reportAgedPayables",
    schema: agingSchema
      .merge(accountingMethodSchema)
      .merge(filtersSchema),
  },
  {
    toolName: "report_aged_payable_detail",
    description:
      "Run an Accounts Payable Aging Detail report showing individual open bills " +
      "grouped by aging period. Uses report_date (not start_date/end_date).",
    methodName: "reportAgedPayableDetail",
    schema: agingSchema
      .merge(accountingMethodSchema)
      .merge(filtersSchema),
  },

  // ── Vendor Expenses ────────────────────────────────────────────────────────

  {
    toolName: "report_vendor_expenses",
    description:
      "Run an Expenses by Vendor report. " +
      "Supports date range, accounting method, summarization, and filters.",
    methodName: "reportVendorExpenses",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(summarizeSchema)
      .merge(filtersSchema),
  },

  // ── Transaction Lists ──────────────────────────────────────────────────────

  {
    toolName: "report_transaction_list",
    description:
      "Run a Transaction List report showing all transactions. " +
      "WARNING: Large date ranges may produce very large responses — use 1-3 month ranges. " +
      "Supports date range, accounting method, filters, and detail extras (columns, sorting).",
    methodName: "reportTransactionList",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(filtersSchema)
      .merge(detailExtrasSchema),
  },
  {
    toolName: "report_transaction_list_with_splits",
    description:
      "Run a Transaction List with Splits report showing transactions with line-item splits. " +
      "WARNING: Large date ranges may produce very large responses — use 1-3 month ranges. " +
      "Supports date range, accounting method, filters, and detail extras.",
    methodName: "reportTransactionListWithSplits",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(filtersSchema)
      .merge(detailExtrasSchema),
  },
  {
    toolName: "report_transaction_list_by_customer",
    description:
      "Run a Transaction List by Customer report. " +
      "WARNING: Large date ranges may produce very large responses — use 1-3 month ranges. " +
      "Supports date range, accounting method, filters, and detail extras.",
    methodName: "reportTransactionListByCustomer",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(filtersSchema)
      .merge(detailExtrasSchema),
  },
  {
    toolName: "report_transaction_list_by_vendor",
    description:
      "Run a Transaction List by Vendor report. " +
      "WARNING: Large date ranges may produce very large responses — use 1-3 month ranges. " +
      "Supports date range, accounting method, filters, and detail extras.",
    methodName: "reportTransactionListByVendor",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(filtersSchema)
      .merge(detailExtrasSchema),
  },

  // ── General Ledger ─────────────────────────────────────────────────────────

  {
    toolName: "report_general_ledger",
    description:
      "Run a General Ledger Detail report showing all transactions per account with running balances. " +
      "WARNING: Large date ranges may produce very large responses — use 1-3 month ranges. " +
      "Supports date range, accounting method, filters, and detail extras (columns, sorting).",
    methodName: "reportGeneralLedgerDetail",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(filtersSchema)
      .merge(detailExtrasSchema),
  },

  // ── Account List ───────────────────────────────────────────────────────────

  {
    toolName: "report_account_list",
    description:
      "Run an Account List Detail report showing all accounts and their details.",
    methodName: "reportAccountListDetail",
    schema: dateRangeSchema,
  },

  // ── Journal ────────────────────────────────────────────────────────────────

  {
    toolName: "report_journal",
    description:
      "Run a Journal Report showing journal entries with debit/credit detail. " +
      "WARNING: Large date ranges may produce very large responses — use 1-3 month ranges. " +
      "Supports date range, accounting method, filters, and detail extras.",
    methodName: "reportJournalReport",
    schema: dateRangeSchema
      .merge(accountingMethodSchema)
      .merge(filtersSchema)
      .merge(detailExtrasSchema),
  },
];
