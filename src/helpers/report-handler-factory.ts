import { ToolDefinition } from "../types/tool-definition.js";
import { ReportConfig } from "../types/report-config.js";
import { runQuickbooksReport } from "../handlers/run-quickbooks-report.handler.js";

/**
 * Factory that creates an MCP ToolDefinition from a ReportConfig.
 * The handler destructures { params } because RegisterTool wraps the schema
 * as { params: schema }, so the MCP SDK delivers validated input under args.params.
 */
export function createReportTool(config: ReportConfig): ToolDefinition<typeof config.schema> {
  const handler = async ({ params }: any) => {
    const response = await runQuickbooksReport(config.methodName, params || {});

    if (response.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error running ${config.toolName}: ${response.error}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(response.result),
        },
      ],
    };
  };

  return {
    name: config.toolName,
    description: config.description,
    schema: config.schema,
    handler,
  };
}
