import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { createExpressApp } from '../../src/transport/http.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ServerFactory } from '../../src/server.js'
import type { ServerConfig } from '../../src/config/schema.js'

// Type for mock transport instance
interface MockTransport {
  sessionId?: string
  onclose?: () => void
  handleRequest: ReturnType<typeof vi.fn>
}

// Type for mock response
interface MockResponse {
  json: (data: unknown) => void
}

// Mock isInitializeRequest to recognize our test requests
vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  isInitializeRequest: (body: unknown) => (body as { method?: string })?.method === 'initialize'
}))

// Mock the StreamableHTTPServerTransport
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(function (
    this: MockTransport,
    options: unknown
  ) {
    this.sessionId = undefined
    this.onclose = undefined
    this.handleRequest = vi.fn(async (_req: unknown, res: MockResponse, body?: unknown) => {
      if (body) {
        res.json({ result: 'success', sessionId: this.sessionId })
      } else {
        res.json({ events: [] })
      }
    })

    // Simulate session initialization
    if (options.onsessioninitialized) {
      setTimeout(() => {
        this.sessionId = 'test-session-123'
        options.onsessioninitialized('test-session-123')
      }, 0)
    }

    return this
  })
}))

describe('HTTP Transport', () => {
  let mockServer: McpServer
  let createMockServer: ServerFactory
  let config: ServerConfig

  beforeEach(() => {
    mockServer = {
      connect: vi.fn().mockResolvedValue(undefined)
    } as unknown as McpServer

    createMockServer = vi.fn().mockReturnValue(mockServer)

    config = {
      name: 'test-server',
      version: '1.0.0',
      host: '127.0.0.1',
      port: 3000
    }

    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Health Check', () => {
    it('should respond to health check endpoint', async () => {
      const app = createExpressApp(createMockServer, config)

      const response = await request(app).get('/health')

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        status: 'ok',
        name: 'test-server',
        version: '1.0.0'
      })
    })

    it('should not include x-powered-by header', async () => {
      const app = createExpressApp(createMockServer, config)

      const response = await request(app).get('/health')

      expect(response.headers['x-powered-by']).toBeUndefined()
    })
  })

  describe('Session Management', () => {
    it('should reject POST without session ID and non-initialize request', async () => {
      const app = createExpressApp(createMockServer, config)

      const response = await request(app)
        .post('/mcp')
        .send({ method: 'tools/list', jsonrpc: '2.0', id: 1 })

      expect(response.status).toBe(400)
      expect(response.body).toEqual({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Invalid session' },
        id: null
      })
    })

    it('should handle GET with invalid session', async () => {
      const app = createExpressApp(createMockServer, config)

      const response = await request(app).get('/mcp').set('mcp-session-id', 'nonexistent-session')

      expect(response.status).toBe(400)
      expect(response.body).toEqual({ error: 'Invalid session' })
    })

    it('should handle DELETE with invalid session', async () => {
      const app = createExpressApp(createMockServer, config)

      const response = await request(app)
        .delete('/mcp')
        .set('mcp-session-id', 'nonexistent-session')

      expect(response.status).toBe(400)
      expect(response.body).toEqual({ error: 'Invalid session' })
    })
  })

  describe('Initialization', () => {
    it('should create a new server instance per session', async () => {
      const app = createExpressApp(createMockServer, config)

      await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            clientInfo: { name: 'test-client', version: '1.0.0' }
          },
          id: 1
        })

      // Wait for session initialization
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(createMockServer).toHaveBeenCalledTimes(1)
      expect(mockServer.connect).toHaveBeenCalled()
    })

    it('should create separate server instances for concurrent sessions', async () => {
      const servers = [
        { connect: vi.fn().mockResolvedValue(undefined) },
        { connect: vi.fn().mockResolvedValue(undefined) }
      ] as unknown as McpServer[]

      let callCount = 0
      const factory = vi.fn(() => servers[callCount++]) as unknown as ServerFactory

      const app = createExpressApp(factory, config)

      // Two concurrent initialize requests
      await Promise.all([
        request(app)
          .post('/mcp')
          .send({
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              clientInfo: { name: 'client-1', version: '1.0.0' }
            },
            id: 1
          }),
        request(app)
          .post('/mcp')
          .send({
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              clientInfo: { name: 'client-2', version: '1.0.0' }
            },
            id: 2
          })
      ])

      expect(factory).toHaveBeenCalledTimes(2)
      expect(servers[0].connect).toHaveBeenCalledTimes(1)
      expect(servers[1].connect).toHaveBeenCalledTimes(1)
    })
  })

  describe('Express Middleware', () => {
    it('should parse JSON body', async () => {
      const app = createExpressApp(createMockServer, config)

      // Test that JSON parsing works by sending an initialize request
      const response = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test', version: '1.0.0' } },
          id: 1
        })

      // If JSON parsing failed, we'd get 400 Bad Request
      expect(response.status).not.toBe(400)
    })

    it('should handle malformed JSON', async () => {
      const app = createExpressApp(createMockServer, config)

      const response = await request(app)
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')

      expect(response.status).toBe(400)
    })
  })
})
