import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createServer, createServerFactory } from '../src/server.js'
import type { Config } from '../src/config/index.js'

// Mock the dependencies
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation((config) => ({
    name: config.name,
    version: config.version,
    tool: vi.fn(),
    connect: vi.fn()
  }))
}))

vi.mock('../src/config/datadog.js', () => ({
  createDatadogClients: vi.fn().mockReturnValue({
    auth: {},
    monitors: {},
    dashboards: {},
    logs: {},
    metrics: {},
    events: {},
    incidents: {},
    slos: {},
    synthetics: {},
    notebooks: {},
    downtimes: {},
    hosts: {},
    tags: {},
    usage: {},
    rum: {},
    security: {},
    teams: {},
    users: {}
  })
}))

vi.mock('../src/tools/index.js', () => ({
  registerAllTools: vi.fn()
}))

describe('Server', () => {
  let config: Config

  beforeEach(() => {
    config = {
      server: {
        name: 'datadog-mcp',
        version: '1.0.0',
        host: '127.0.0.1',
        port: 3000
      },
      datadog: {
        apiKey: 'test-api-key',
        appKey: 'test-app-key',
        site: 'datadoghq.com'
      },
      limits: {
        maxResults: 100,
        maxLogLines: 500,
        maxMetricDataPoints: 1000,
        defaultTimeRangeHours: 24
      },
      features: {
        readOnly: false
      }
    }
  })

  describe('createServer', () => {
    it('should create server with correct name and version', () => {
      const server = createServer(config)

      expect(server).toBeDefined()
      expect(server.name).toBe('datadog-mcp')
      expect(server.version).toBe('1.0.0')
    })

    it('should create server with custom config', () => {
      config.server.name = 'custom-server'
      config.server.version = '2.0.0'

      const server = createServer(config)

      expect(server.name).toBe('custom-server')
      expect(server.version).toBe('2.0.0')
    })

    it('should call createDatadogClients with datadog config', async () => {
      const { createDatadogClients } = await import('../src/config/datadog.js')

      createServer(config)

      expect(createDatadogClients).toHaveBeenCalledWith(config.datadog)
    })

    it('should call registerAllTools with correct parameters', async () => {
      const { registerAllTools } = await import('../src/tools/index.js')

      const server = createServer(config)

      expect(registerAllTools).toHaveBeenCalledWith(
        server,
        expect.any(Object), // clients
        config.limits,
        config.features,
        'datadoghq.com',
        config.datadog
      )
    })

    it('should pass readOnly feature to registerAllTools', async () => {
      const { registerAllTools } = await import('../src/tools/index.js')

      config.features.readOnly = true
      const server = createServer(config)

      expect(registerAllTools).toHaveBeenCalledWith(
        server,
        expect.any(Object),
        config.limits,
        { readOnly: true },
        'datadoghq.com',
        config.datadog
      )
    })

    it('should pass custom limits to registerAllTools', async () => {
      const { registerAllTools } = await import('../src/tools/index.js')

      config.limits.maxResults = 200
      config.limits.maxLogLines = 1000

      createServer(config)

      expect(registerAllTools).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        {
          maxResults: 200,
          maxLogLines: 1000,
          maxMetricDataPoints: 1000,
          defaultTimeRangeHours: 24
        },
        expect.any(Object),
        'datadoghq.com',
        config.datadog
      )
    })

    it('should pass custom Datadog site to registerAllTools', async () => {
      const { registerAllTools } = await import('../src/tools/index.js')

      config.datadog.site = 'datadoghq.eu'

      createServer(config)

      expect(registerAllTools).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        'datadoghq.eu',
        config.datadog
      )
    })
  })

  describe('createServerFactory', () => {
    it('should return a function', () => {
      const factory = createServerFactory(config)

      expect(typeof factory).toBe('function')
    })

    it('should create Datadog clients once on factory creation', async () => {
      const { createDatadogClients } = await import('../src/config/datadog.js')
      vi.mocked(createDatadogClients).mockClear()

      const factory = createServerFactory(config)

      expect(createDatadogClients).toHaveBeenCalledTimes(1)
      expect(createDatadogClients).toHaveBeenCalledWith(config.datadog)

      // Additional calls to the factory should NOT create new clients
      factory()
      factory()

      expect(createDatadogClients).toHaveBeenCalledTimes(1)
    })

    it('should produce distinct server instances per call', () => {
      const factory = createServerFactory(config)

      const server1 = factory()
      const server2 = factory()

      expect(server1).not.toBe(server2)
    })

    it('should register tools on each produced server', async () => {
      const { registerAllTools } = await import('../src/tools/index.js')
      vi.mocked(registerAllTools).mockClear()

      const factory = createServerFactory(config)
      factory()
      factory()

      expect(registerAllTools).toHaveBeenCalledTimes(2)
    })

    it('should share the same clients across server instances', async () => {
      const { registerAllTools } = await import('../src/tools/index.js')
      vi.mocked(registerAllTools).mockClear()

      const factory = createServerFactory(config)
      factory()
      factory()

      // Both calls should receive the same clients reference
      const firstClients = vi.mocked(registerAllTools).mock.calls[0][1]
      const secondClients = vi.mocked(registerAllTools).mock.calls[1][1]

      expect(firstClients).toBe(secondClients)
    })
  })
})
