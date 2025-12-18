/**
 * HTTP/StreamableHTTP transport for MCP server
 * Allows running the server over HTTP with configurable port
 */
import express, { Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { ServerConfig } from '../config/schema.js'

// Store active transports by session ID
const transports: Record<string, StreamableHTTPServerTransport> = {}

export async function connectHttp(server: McpServer, config: ServerConfig): Promise<void> {
  const app = express()
  app.use(express.json())

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
      // New session initialization
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

  // Start server
  app.listen(config.port, config.host, () => {
    console.error(`[MCP] Datadog MCP server running on http://${config.host}:${config.port}/mcp`)
    console.error(`[MCP] Health check available at http://${config.host}:${config.port}/health`)
  })
}
