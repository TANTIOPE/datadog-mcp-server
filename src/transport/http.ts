/**
 * HTTP/StreamableHTTP transport for MCP server
 * Allows running the server over HTTP with configurable port
 *
 * Creates a new McpServer per session to avoid the single-transport
 * limitation of Protocol.connect() — concurrent sessions each get
 * their own server instance with isolated transport routing.
 */
import express, { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { ServerFactory } from '../server.js'
import type { ServerConfig } from '../config/schema.js'

/**
 * Creates and configures an Express app for MCP server
 * Exported for testing purposes
 */
export function createExpressApp(
  createServer: ServerFactory,
  config: ServerConfig
): express.Application {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json())

  const transports: Record<string, StreamableHTTPServerTransport> = {}

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', name: config.name, version: config.version })
  })

  // MCP endpoint - handles POST, GET, DELETE
  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    let transport: StreamableHTTPServerTransport

    if (sessionId && transports[sessionId]) {
      // Reuse existing session
      transport = transports[sessionId]
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New session — create dedicated server instance
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports[id] = transport
          console.error(`[MCP] Session initialized: ${id}`)
        }
      })

      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports[transport.sessionId]
          console.error(`[MCP] Session closed: ${transport.sessionId}`)
        }
      }

      const server = createServer()
      await server.connect(transport)
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid session' },
        id: null
      })
      return
    }

    await transport.handleRequest(req, res, req.body)
  })

  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string
    const transport = transports[sessionId]
    if (transport) {
      await transport.handleRequest(req, res)
    } else {
      res.status(400).json({ error: 'Invalid session' })
    }
  })

  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string
    const transport = transports[sessionId]
    if (transport) {
      await transport.handleRequest(req, res)
    } else {
      res.status(400).json({ error: 'Invalid session' })
    }
  })

  return app
}

export async function connectHttp(
  createServer: ServerFactory,
  config: ServerConfig
): Promise<void> {
  const app = createExpressApp(createServer, config)

  // Start server
  app.listen(config.port, config.host, () => {
    console.error(`[MCP] Datadog MCP server running on http://${config.host}:${config.port}/mcp`)
    console.error(`[MCP] Health check available at http://${config.host}:${config.port}/health`)
  })
}
