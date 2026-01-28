import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createDatadogClients } from './config/datadog.js'
import { registerAllTools } from './tools/index.js'
import type { Config } from './config/index.js'

export function createServer(config: Config): McpServer {
  const server = new McpServer({
    name: config.server.name,
    version: config.server.version
  })

  const clients = createDatadogClients(config.datadog)

  registerAllTools(
    server,
    clients,
    config.limits,
    config.features,
    config.datadog.site,
    config.datadog
  )

  return server
}
