import { loadConfig } from './config/index.js'
import { createServer, createServerFactory } from './server.js'
import { connectStdio, connectHttp } from './transport/index.js'

try {
  const config = loadConfig()

  if (config.server.transport === 'http') {
    const factory = createServerFactory(config)
    await connectHttp(factory, config.server)
  } else {
    const server = createServer(config)
    await connectStdio(server)
  }
} catch (error) {
  console.error('[MCP] Failed to start server:', error)
  process.exit(1)
}
