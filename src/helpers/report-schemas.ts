import { z } from "zod";

/**
 * Composable Zod schema fragments for QuickBooks Online report parameters.
 * Each group can be merged into a per-report schema via z.object({}).merge().
 *
 * Parameter names match the exact QBO API query param keys (snake_case).
 * node-quickbooks passes these through directly as query params.
 */

// ── Group A: Date Range (most financial reports) ──────────────────────────────

export const dateRangeSchema = z.object({
  start_date: z
    .string()
    .optional()
    .describe("Start date in YYYY-MM-DD format. Must be less than end_date."),
  end_date: z
    .string()
    .optional()
    .describe("End date in YYYY-MM-DD format. Must be greater than start_date."),
  date_macro: z
    .string()
    .optional()
    .describe(
      "Predefined date range. Common values: Today, Yesterday, This Week, Last Week, " +
      "This Week-to-date, Last Week-to-date, Next Week, Next 4 Weeks, This Month, Last Month, " +
      "This Month-to-date, Last Month-to-date, Next Month, This Fiscal Quarter, Last Fiscal Quarter, " +
      "This Fiscal Quarter-to-date, Last Fiscal Quarter-to-date, Next Fiscal Quarter, " +
      "This Fiscal Year, Last Fiscal Year, This Fiscal Year-to-date, Last Fiscal Year-to-date, Next Fiscal Year. " +
      "Use this OR start_date/end_date, not both."
    ),
});

// ── Group B: Aging (A/R and A/P aging reports) ────────────────────────────────

export const agingSchema = z.object({
  report_date: z
    .string()
    .optional()
    .describe("The as-of date for the aging report in YYYY-MM-DD format."),
  date_macro: z
    .string()
    .optional()
    .describe(
      "Predefined date range. Common values: Today, Yesterday, This Week, Last Week, " +
      "This Month, Last Month, This Fiscal Quarter, Last Fiscal Quarter, " +
      "This Fiscal Year, Last Fiscal Year. Use this OR report_date, not both."
    ),
  aging_period: z
    .number()
    .optional()
    .describe("Number of days in each aging period (default 30)."),
  aging_method: z
    .enum(["Current", "Report_Date"])
    .optional()
    .describe("Whether to age balances as of today or the report date."),
  days_per_aging_period: z
    .number()
    .optional()
    .describe("Number of days per aging period, using the upstream report parameter."),
  num_periods: z
    .number()
    .optional()
    .describe("Number of aging periods to show (default 4)."),
});

// ── Group C: Accounting Method ────────────────────────────────────────────────

export const accountingMethodSchema = z.object({
  accounting_method: z
    .enum(["Cash", "Accrual"])
    .optional()
    .describe(
      "Accounting method for the report. If omitted, uses the company's default from Preferences."
    ),
});

// ── Group D: Summarization ────────────────────────────────────────────────────

export const summarizeSchema = z.object({
  summarize_column_by: z
    .string()
    .optional()
    .describe(
      "How to group report columns. Values: Total, Month, Week, Days, Quarter, Year, " +
      "Customers, Vendors, Classes, Departments, Employees, ProductsAndServices."
    ),
});

// ── Group E: Filters ──────────────────────────────────────────────────────────

export const filtersSchema = z.object({
  customer: z
    .string()
    .optional()
    .describe("Filter by customer. One or more comma-separated customer IDs."),
  vendor: z
    .string()
    .optional()
    .describe("Filter by vendor. One or more comma-separated vendor IDs."),
  department: z
    .string()
    .optional()
    .describe("Filter by department. One or more comma-separated department IDs."),
  class: z
    .string()
    .optional()
    .describe("Filter by class. One or more comma-separated class IDs."),
  employee: z
    .string()
    .optional()
    .describe("Filter by employee. One or more comma-separated employee IDs."),
  item: z
    .string()
    .optional()
    .describe("Filter by item. One or more comma-separated item IDs."),
  account: z
    .string()
    .optional()
    .describe("Filter by account. One or more comma-separated account IDs."),
});

// ── Group F: Detail Extras (detail + transaction reports) ─────────────────────

export const detailExtrasSchema = z.object({
  columns: z
    .string()
    .optional()
    .describe(
      "Comma-separated column types to include. Common values: " +
      "create_by, create_date, doc_num, last_mod_by, last_mod_date, memo, name, " +
      "pmt_mthd, split_acc, tx_date, txn_type."
    ),
  sort_by: z
    .string()
    .optional()
    .describe("Column type to sort by. Must be one of the columns in the report."),
  sort_order: z
    .enum(["ascend", "descend"])
    .optional()
    .describe("Sort order for the report results."),
  start_duedate: z
    .string()
    .optional()
    .describe("Filter by due date start in YYYY-MM-DD format."),
  end_duedate: z
    .string()
    .optional()
    .describe("Filter by due date end in YYYY-MM-DD format."),
});
