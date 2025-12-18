import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadConfig, ALL_TOOLS } from '../../src/config/index.js'

describe('Config Loading', () => {
  const originalArgv = process.argv
  const originalEnv = process.env

  beforeEach(() => {
    // Reset process.argv and process.env before each test
    process.argv = ['node', 'script.js']
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.argv = originalArgv
    process.env = originalEnv
  })

  describe('loadConfig', () => {
    it('should load config with minimal environment variables', () => {
      process.env.DD_API_KEY = 'test-api-key'
      process.env.DD_APP_KEY = 'test-app-key'

      const config = loadConfig()

      expect(config.datadog.apiKey).toBe('test-api-key')
      expect(config.datadog.appKey).toBe('test-app-key')
      expect(config.datadog.site).toBe('datadoghq.com') // default
      expect(config.server.transport).toBe('stdio') // default
      expect(config.server.port).toBe(3000) // default
      expect(config.features.readOnly).toBe(false) // default
    })

    it('should load config with all environment variables', () => {
      process.env.DD_API_KEY = 'api-key'
      process.env.DD_APP_KEY = 'app-key'
      process.env.DD_SITE = 'datadoghq.eu'
      process.env.MCP_TRANSPORT = 'http'
      process.env.MCP_PORT = '8080'
      process.env.MCP_HOST = '0.0.0.0'
      process.env.MCP_MAX_RESULTS = '200'
      process.env.MCP_MAX_LOG_LINES = '1000'
      process.env.MCP_MAX_METRIC_POINTS = '2000'
      process.env.MCP_DEFAULT_TIME_RANGE = '48'
      process.env.MCP_READ_ONLY = 'true'

      const config = loadConfig()

      expect(config.datadog.site).toBe('datadoghq.eu')
      expect(config.server.transport).toBe('http')
      expect(config.server.port).toBe(8080)
      expect(config.server.host).toBe('0.0.0.0')
      expect(config.limits.maxResults).toBe(200)
      expect(config.limits.maxLogLines).toBe(1000)
      expect(config.limits.maxMetricDataPoints).toBe(2000)
      expect(config.limits.defaultTimeRangeHours).toBe(48)
      expect(config.features.readOnly).toBe(true)
    })

    it('should parse CLI arg with --key=value format', () => {
      process.env.DD_API_KEY = 'key'
      process.env.DD_APP_KEY = 'key'
      process.argv = ['node', 'script.js', '--site=us5.datadoghq.com']

      const config = loadConfig()

      expect(config.datadog.site).toBe('us5.datadoghq.com')
    })

    it('should parse CLI arg with --key value format', () => {
      process.env.DD_API_KEY = 'key'
      process.env.DD_APP_KEY = 'key'
      process.argv = ['node', 'script.js', '--port', '9000']

      const config = loadConfig()

      expect(config.server.port).toBe(9000)
    })

    it('should parse boolean CLI flags', () => {
      process.env.DD_API_KEY = 'key'
      process.env.DD_APP_KEY = 'key'
      process.argv = ['node', 'script.js', '--read-only']

      const config = loadConfig()

      expect(config.features.readOnly).toBe(true)
    })

    it('should parse disabled tools from CLI', () => {
      process.env.DD_API_KEY = 'key'
      process.env.DD_APP_KEY = 'key'
      process.argv = ['node', 'script.js', '--disable-tools=incidents,notebooks']

      const config = loadConfig()

      expect(config.features.disabledTools).toEqual(['incidents', 'notebooks'])
    })

    it('should parse disabled tools from environment', () => {
      process.env.DD_API_KEY = 'key'
      process.env.DD_APP_KEY = 'key'
      process.env.MCP_DISABLE_TOOLS = 'monitors,logs'

      const config = loadConfig()

      expect(config.features.disabledTools).toEqual(['monitors', 'logs'])
    })

    it('should handle value with equals sign in it', () => {
      process.env.DD_API_KEY = 'key=with=equals'
      process.env.DD_APP_KEY = 'key'

      const config = loadConfig()

      expect(config.datadog.apiKey).toBe('key=with=equals')
    })

    it('should filter out invalid tool names', () => {
      process.env.DD_API_KEY = 'key'
      process.env.DD_APP_KEY = 'key'
      process.argv = ['node', 'script.js', '--disable-tools=incidents,invalidtool,notebooks']

      const config = loadConfig()

      // Only valid tools should be included
      expect(config.features.disabledTools).toEqual(['incidents', 'notebooks'])
      expect(config.features.disabledTools).not.toContain('invalidtool')
    })

    it('should handle empty disabled tools string', () => {
      process.env.DD_API_KEY = 'key'
      process.env.DD_APP_KEY = 'key'
      process.env.MCP_DISABLE_TOOLS = ''

      const config = loadConfig()

      expect(config.features.disabledTools).toEqual([])
    })

    it('should trim whitespace from disabled tools', () => {
      process.env.DD_API_KEY = 'key'
      process.env.DD_APP_KEY = 'key'
      process.argv = ['node', 'script.js', '--disable-tools=incidents , notebooks , monitors']

      const config = loadConfig()

      expect(config.features.disabledTools).toEqual(['incidents', 'notebooks', 'monitors'])
    })

    it('should handle case-insensitive tool names', () => {
      process.env.DD_API_KEY = 'key'
      process.env.DD_APP_KEY = 'key'
      process.argv = ['node', 'script.js', '--disable-tools=INCIDENTS,NoteBooKs']

      const config = loadConfig()

      expect(config.features.disabledTools).toEqual(['incidents', 'notebooks'])
    })

    it('should prioritize CLI args over environment variables', () => {
      process.env.DD_API_KEY = 'key'
      process.env.DD_APP_KEY = 'key'
      process.env.DD_SITE = 'datadoghq.eu'
      process.env.MCP_PORT = '8080'
      process.argv = ['node', 'script.js', '--site=us5.datadoghq.com', '--port', '9000']

      const config = loadConfig()

      expect(config.datadog.site).toBe('us5.datadoghq.com')
      expect(config.server.port).toBe(9000)
    })

    it('should handle multiple CLI arguments together', () => {
      process.env.DD_API_KEY = 'key'
      process.env.DD_APP_KEY = 'key'
      process.argv = [
        'node',
        'script.js',
        '--transport=http',
        '--port',
        '8080',
        '--host',
        'api.example.com',
        '--read-only'
      ]

      const config = loadConfig()

      expect(config.server.transport).toBe('http')
      expect(config.server.port).toBe(8080)
      expect(config.server.host).toBe('api.example.com')
      expect(config.features.readOnly).toBe(true)
    })

    it('should use default limits when env vars not set', () => {
      process.env.DD_API_KEY = 'key'
      process.env.DD_APP_KEY = 'key'

      const config = loadConfig()

      expect(config.limits.maxResults).toBe(100)
      expect(config.limits.maxLogLines).toBe(500)
      expect(config.limits.maxMetricDataPoints).toBe(1000)
      expect(config.limits.defaultTimeRangeHours).toBe(24)
    })

    it('should have default limit of 25 in schema', () => {
      process.env.DD_API_KEY = 'key'
      process.env.DD_APP_KEY = 'key'

      const config = loadConfig()

      // defaultLimit comes from schema default
      expect(config.limits.defaultLimit).toBe(25)
    })
  })

  describe('ALL_TOOLS constant', () => {
    it('should export all tool names', () => {
      expect(ALL_TOOLS).toBeDefined()
      expect(Array.isArray(ALL_TOOLS)).toBe(true)
      expect(ALL_TOOLS.length).toBeGreaterThan(0)

      // Check some expected tools
      expect(ALL_TOOLS).toContain('monitors')
      expect(ALL_TOOLS).toContain('logs')
      expect(ALL_TOOLS).toContain('metrics')
      expect(ALL_TOOLS).toContain('traces')
      expect(ALL_TOOLS).toContain('incidents')
    })
  })
})
