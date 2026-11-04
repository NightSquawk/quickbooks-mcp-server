import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

export class QuickbooksMCPServer {
  private static instance: McpServer | null = null;

  private constructor() {}

  public static GetServer(): McpServer {
    if (QuickbooksMCPServer.instance === null) {
      QuickbooksMCPServer.instance = new McpServer(
        {
          name: "QuickBooks Online MCP Server",
          version,
        },
        {
          capabilities: {
            tools: {},
          },
        }
      );
    }
    return QuickbooksMCPServer.instance;
  }
}
