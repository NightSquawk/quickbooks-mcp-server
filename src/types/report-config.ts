import { z } from "zod";

export interface ReportConfig {
  /** MCP tool name, e.g. "report_balance_sheet" */
  toolName: string;
  /** Human-readable description for the LLM */
  description: string;
  /** The node-quickbooks method name, e.g. "reportBalanceSheet" */
  methodName: string;
  /** Zod schema for this report's accepted parameters */
  schema: z.ZodObject<any>;
}
