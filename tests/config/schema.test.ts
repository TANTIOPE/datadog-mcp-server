import { describe, it, expect } from 'vitest'
import { configSchema, ALL_TOOLS } from '../../src/config/schema.js'

describe('Config Schema', () => {
  describe('valid configurations', () => {
    it('should validate a minimal valid config', () => {
      const config = {
        datadog: {
          apiKey: 'test-api-key',
          appKey: 'test-app-key'
        }
      }

      const result = configSchema.parse(config)

      expect(result.datadog.apiKey).toBe('test-api-key')
      expect(result.datadog.appKey).toBe('test-app-key')
      expect(result.datadog.site).toBe('datadoghq.com')
    })

    it('should validate a full config with all fields', () => {
      const config = {
        datadog: {
          apiKey: 'test-api-key',
          appKey: 'test-app-key',
          site: 'datadoghq.eu'
        },
        server: {
          name: 'my-datadog-mcp',
          version: '2.0.0',
          transport: 'http' as const,
          port: 8080,
          host: '0.0.0.0'
        },
        limits: {
          defaultLimit: 100,
          defaultLogLines: 300,
          defaultMetricDataPoints: 2000,
          defaultTimeRangeHours: 48
        },
        features: {
          readOnly: true,
          disabledTools: ['synthetics', 'rum']
        }
      }

      const result = configSchema.parse(config)

      expect(result.datadog.site).toBe('datadoghq.eu')
      expect(result.server.transport).toBe('http')
      expect(result.server.port).toBe(8080)
      expect(result.limits.defaultLimit).toBe(100)
      expect(result.limits.defaultLogLines).toBe(300)
      expect(result.limits.defaultMetricDataPoints).toBe(2000)
      expect(result.features.readOnly).toBe(true)
      expect(result.features.disabledTools).toEqual(['synthetics', 'rum'])
    })

    it('should apply default values for server config', () => {
      const config = {
        datadog: {
          apiKey: 'test-api-key',
          appKey: 'test-app-key'
        }
      }

      const result = configSchema.parse(config)

      expect(result.server.name).toBe('datadog-mcp')
      expect(result.server.version).toBe('1.0.0')
      expect(result.server.transport).toBe('stdio')
      expect(result.server.port).toBe(3000)
      expect(result.server.host).toBe('localhost')
    })

    it('should apply default values for limits config', () => {
      const config = {
        datadog: {
          apiKey: 'test-api-key',
          appKey: 'test-app-key'
        }
      }

      const result = configSchema.parse(config)

      expect(result.limits.defaultLimit).toBe(50)
      expect(result.limits.defaultLogLines).toBe(200)
      expect(result.limits.defaultMetricDataPoints).toBe(1000)
      expect(result.limits.defaultTimeRangeHours).toBe(24)
    })

    it('should apply default values for features config', () => {
      const config = {
        datadog: {
          apiKey: 'test-api-key',
          appKey: 'test-app-key'
        }
      }

      const result = configSchema.parse(config)

      expect(result.features.readOnly).toBe(false)
      expect(result.features.disabledTools).toEqual([])
    })
  })

  describe('invalid configurations', () => {
    it('should reject config without apiKey', () => {
      const config = {
        datadog: {
          appKey: 'test-app-key'
        }
      }

      expect(() => configSchema.parse(config)).toThrow()
    })

    it('should reject config without appKey', () => {
      const config = {
        datadog: {
          apiKey: 'test-api-key'
        }
      }

      expect(() => configSchema.parse(config)).toThrow()
    })

    it('should reject config with empty apiKey', () => {
      const config = {
        datadog: {
          apiKey: '',
          appKey: 'test-app-key'
        }
      }

      expect(() => configSchema.parse(config)).toThrow(/DD_API_KEY is required/)
    })

    it('should reject config with empty appKey', () => {
      const config = {
        datadog: {
          apiKey: 'test-api-key',
          appKey: ''
        }
      }

      expect(() => configSchema.parse(config)).toThrow(/DD_APP_KEY is required/)
    })

    it('should reject config with invalid transport', () => {
      const config = {
        datadog: {
          apiKey: 'test-api-key',
          appKey: 'test-app-key'
        },
        server: {
          transport: 'invalid'
        }
      }

      expect(() => configSchema.parse(config)).toThrow()
    })
  })

  describe('ALL_TOOLS constant', () => {
    it('should contain all expected tool names', () => {
      expect(ALL_TOOLS).toEqual([
        'monitors',
        'dashboards',
        'logs',
        'metrics',
        'traces',
        'events',
        'incidents',
        'slos',
        'synthetics',
        'hosts',
        'downtimes',
        'rum',
        'security',
        'notebooks',
        'users',
        'teams',
        'tags',
        'usage',
        'auth'
      ])
    })

    it('should have 19 tools', () => {
      expect(ALL_TOOLS).toHaveLength(19)
    })
  })
})
