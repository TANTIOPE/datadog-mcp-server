import { loadConfig } from './config/index.js'
import { createServer } from './server.js'
import { connectStdio, connectHttp } from './transport/index.js'

async function main(): Promise<void> {
  try {
    const config = loadConfig()
    const server = createServer(config)

    if (config.server.transport === 'http') {
      await connectHttp(server, config.server)
    } else {
      await connectStdio(server)
    }
  } catch (error) {
    console.error('[MCP] Failed to start server:', error)
    process.exit(1)
  }
}

main()
