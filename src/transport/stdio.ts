import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

export async function connectStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[MCP] Datadog MCP server running on stdio')
}
