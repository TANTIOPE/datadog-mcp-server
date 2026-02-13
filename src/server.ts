import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createDatadogClients } from './config/datadog.js'
import { registerAllTools } from './tools/index.js'
import type { Config } from './config/index.js'

export type ServerFactory = () => McpServer

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

/**
 * Creates a factory that produces a new McpServer per call.
 * Datadog API clients are created once and shared across instances.
 *
 * Required for HTTP transport: Protocol.connect() supports a single
 * transport, so concurrent sessions each need their own McpServer.
 */
export function createServerFactory(config: Config): ServerFactory {
  const clients = createDatadogClients(config.datadog)

  return () => {
    const server = new McpServer({
      name: config.server.name,
      version: config.server.version
    })

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
}
