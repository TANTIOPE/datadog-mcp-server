/**
 * Comprehensive async tests for logs.ts
 * Tests all async functions with focus on edge cases, pagination, error handling
 */
import { describe, it, expect, vi } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { searchLogs, aggregateLogs } from '../../src/tools/logs.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24,
  defaultLimit: 25
}

// Factory function for creating mock logs
function createMockLog(overrides?: Partial<v2.Log>): v2.Log {
  return {
    id: 'log-123',
    type: 'log',
    attributes: {
      timestamp: new Date('2024-01-20T12:00:00Z'),
      message: 'Sample log message',
      status: 'info',
      service: 'web-api',
      host: 'web-1',
      tags: ['env:prod', 'version:1.0'],
      attributes: {},
      ...overrides?.attributes
    },
    ...overrides
  }
}

describe('Logs Async Functions', () => {
  describe('searchLogs', () => {
    it('should search logs with query', async () => {
      const mockLogs = [createMockLog({ id: 'log-1' }), createMockLog({ id: 'log-2' })]

      const mockApi = {
        listLogs: vi.fn().mockResolvedValue({
          data: mockLogs,
          meta: { page: {} }
        })
      } as unknown as v2.LogsApi

      const result = await searchLogs(
        mockApi,
        { query: 'service:web-api status:error' },
        defaultLimits,
        'datadoghq.com'
      )

      expect(mockApi.listLogs).toHaveBeenCalledTimes(1)
      expect(result.logs).toHaveLength(2)
      expect(result.meta.count).toBe(2)
    })

    it('should handle multiple logs in single fetch', async () => {
      const mockLogs = [
        createMockLog({ id: 'log-1' }),
        createMockLog({ id: 'log-2' }),
        createMockLog({ id: 'log-3' })
      ]

      const mockApi = {
        listLogs: vi.fn().mockResolvedValue({
          data: mockLogs,
          meta: { page: {} }
        })
      } as unknown as v2.LogsApi

      const result = await searchLogs(mockApi, { query: '*' }, defaultLimits, 'datadoghq.com')

      expect(mockApi.listLogs).toHaveBeenCalledTimes(1)
      expect(result.logs).toHaveLength(3)
      expect(result.meta.count).toBe(3)
    })

    it('should respect maxLogLines limit in fetch', async () => {
      const limits = { ...defaultLimits, maxLogLines: 2 }

      const mockApi = {
        listLogs: vi.fn().mockResolvedValue({
          data: [createMockLog({ id: 'log-1' })],
          meta: { page: {} }
        })
      } as unknown as v2.LogsApi

      await searchLogs(mockApi, { query: '*' }, limits, 'datadoghq.com')

      // Should request with maxLogLines limit
      const call = mockApi.listLogs.mock.calls[0][0]
      expect(call.body.page?.limit).toBeLessThanOrEqual(limits.maxLogLines)
    })

    it('should build query with keyword filter', async () => {
      const mockApi = {
        listLogs: vi.fn().mockResolvedValue({
          data: [],
          meta: { page: {} }
        })
      } as unknown as v2.LogsApi

      await searchLogs(
        mockApi,
        { query: 'service:web', keyword: 'timeout' },
        defaultLimits,
        'datadoghq.com'
      )

      const call = mockApi.listLogs.mock.calls[0][0]
      expect(call.body.filter?.query).toContain('service:web')
      expect(call.body.filter?.query).toContain('timeout')
    })

    it('should build query with pattern (regex)', async () => {
      const mockApi = {
        listLogs: vi.fn().mockResolvedValue({
          data: [],
          meta: { page: {} }
        })
      } as unknown as v2.LogsApi

      await searchLogs(mockApi, { pattern: 'ERROR.*timeout' }, defaultLimits, 'datadoghq.com')

      const call = mockApi.listLogs.mock.calls[0][0]
      expect(call.body.filter?.query).toBeDefined()
    })

    it('should add service filter', async () => {
      const mockApi = {
        listLogs: vi.fn().mockResolvedValue({
          data: [],
          meta: { page: {} }
        })
      } as unknown as v2.LogsApi

      await searchLogs(mockApi, { service: 'web-api' }, defaultLimits, 'datadoghq.com')

      const call = mockApi.listLogs.mock.calls[0][0]
      expect(call.body.filter?.query).toContain('service:web-api')
    })

    it('should add host filter', async () => {
      const mockApi = {
        listLogs: vi.fn().mockResolvedValue({
          data: [],
          meta: { page: {} }
        })
      } as unknown as v2.LogsApi

      await searchLogs(mockApi, { host: 'web-1' }, defaultLimits, 'datadoghq.com')

      const call = mockApi.listLogs.mock.calls[0][0]
      expect(call.body.filter?.query).toContain('host:web-1')
    })

    it('should add status filter', async () => {
      const mockApi = {
        listLogs: vi.fn().mockResolvedValue({
          data: [],
          meta: { page: {} }
        })
      } as unknown as v2.LogsApi

      await searchLogs(mockApi, { status: 'error' }, defaultLimits, 'datadoghq.com')

      const call = mockApi.listLogs.mock.calls[0][0]
      expect(call.body.filter?.query).toContain('status:error')
    })

    it('should set time range from params', async () => {
      const mockApi = {
        listLogs: vi.fn().mockResolvedValue({
          data: [],
          meta: { page: {} }
        })
      } as unknown as v2.LogsApi

      await searchLogs(
        mockApi,
        {
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z'
        },
        defaultLimits,
        'datadoghq.com'
      )

      const call = mockApi.listLogs.mock.calls[0][0]
      expect(call.body.filter?.from).toBeDefined()
      expect(call.body.filter?.to).toBeDefined()
    })

    it('should use default time range when not provided', async () => {
      const mockApi = {
        listLogs: vi.fn().mockResolvedValue({
          data: [],
          meta: { page: {} }
        })
      } as unknown as v2.LogsApi

      await searchLogs(mockApi, {}, defaultLimits, 'datadoghq.com')

      const call = mockApi.listLogs.mock.calls[0][0]
      expect(call.body.filter?.from).toBeDefined()
      expect(call.body.filter?.to).toBeDefined()
    })

    it('should set indexes when provided', async () => {
      const mockApi = {
        listLogs: vi.fn().mockResolvedValue({
          data: [],
          meta: { page: {} }
        })
      } as unknown as v2.LogsApi

      await searchLogs(mockApi, { indexes: ['main', 'archive'] }, defaultLimits, 'datadoghq.com')

      const call = mockApi.listLogs.mock.calls[0][0]
      expect(call.body.filter?.indexes).toEqual(['main', 'archive'])
    })

    it('should set sort order', async () => {
      const mockApi = {
        listLogs: vi.fn().mockResolvedValue({
          data: [],
          meta: { page: {} }
        })
      } as unknown as v2.LogsApi

      await searchLogs(mockApi, { sort: '-timestamp' }, defaultLimits, 'datadoghq.com')

      const call = mockApi.listLogs.mock.calls[0][0]
      expect(call.body.sort).toBe('-timestamp')
    })

    it('should respect limit parameter', async () => {
      const mockApi = {
        listLogs: vi.fn().mockResolvedValue({
          data: [],
          meta: { page: {} }
        })
      } as unknown as v2.LogsApi

      await searchLogs(mockApi, { limit: 50 }, defaultLimits, 'datadoghq.com')

      const call = mockApi.listLogs.mock.calls[0][0]
      expect(call.body.page?.limit).toBe(50)
    })

    it('should handle empty results', async () => {
      const mockApi = {
        listLogs: vi.fn().mockResolvedValue({
          data: [],
          meta: { page: {} }
        })
      } as unknown as v2.LogsApi

      const result = await searchLogs(
        mockApi,
        { query: 'nonexistent' },
        defaultLimits,
        'datadoghq.com'
      )

      expect(result.logs).toHaveLength(0)
      expect(result.meta.count).toBe(0)
    })

    it('should include Datadog URL in result', async () => {
      const mockApi = {
        listLogs: vi.fn().mockResolvedValue({
          data: [createMockLog()],
          meta: { page: {} }
        })
      } as unknown as v2.LogsApi

      const result = await searchLogs(
        mockApi,
        { query: 'test', from: '2024-01-20T00:00:00Z', to: '2024-01-20T23:59:59Z' },
        defaultLimits,
        'datadoghq.com'
      )

      expect(result.meta.datadog_url).toContain('datadoghq.com')
      expect(result.meta.datadog_url).toContain('logs')
    })
  })

  describe('aggregateLogs', () => {
    it('should aggregate logs with groupBy', async () => {
      const mockApi = {
        aggregateLogs: vi.fn().mockResolvedValue({
          data: {
            buckets: [
              {
                by: { service: 'web-api' },
                computes: { c0: 100 }
              }
            ]
          }
        })
      } as unknown as v2.LogsApi

      const result = await aggregateLogs(
        mockApi,
        { query: '*', groupBy: ['service'] },
        defaultLimits,
        'datadoghq.com'
      )

      expect(mockApi.aggregateLogs).toHaveBeenCalledTimes(1)
      expect(result.buckets).toHaveLength(1)
      expect(result.buckets[0].by).toEqual({ service: 'web-api' })
    })

    it('should handle multiple buckets in single aggregation', async () => {
      const mockApi = {
        aggregateLogs: vi.fn().mockResolvedValue({
          data: {
            buckets: [
              { by: { service: 'web-api' }, computes: { c0: 100 } },
              { by: { service: 'auth' }, computes: { c0: 50 } }
            ]
          }
        })
      } as unknown as v2.LogsApi

      const result = await aggregateLogs(
        mockApi,
        { query: '*', groupBy: ['service'] },
        defaultLimits,
        'datadoghq.com'
      )

      expect(mockApi.aggregateLogs).toHaveBeenCalledTimes(1)
      expect(result.buckets).toHaveLength(2)
    })

    it('should use query parameter for aggregation', async () => {
      const mockApi = {
        aggregateLogs: vi.fn().mockResolvedValue({
          data: { buckets: [] }
        })
      } as unknown as v2.LogsApi

      await aggregateLogs(
        mockApi,
        {
          query: 'status:error service:web-api',
          groupBy: ['host']
        },
        defaultLimits,
        'datadoghq.com'
      )

      const call = mockApi.aggregateLogs.mock.calls[0][0]
      expect(call.body.filter?.query).toBe('status:error service:web-api')
    })

    it('should set time range for aggregation', async () => {
      const mockApi = {
        aggregateLogs: vi.fn().mockResolvedValue({
          data: { buckets: [] }
        })
      } as unknown as v2.LogsApi

      await aggregateLogs(
        mockApi,
        {
          query: '*',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z',
          groupBy: ['service']
        },
        defaultLimits,
        'datadoghq.com'
      )

      const call = mockApi.aggregateLogs.mock.calls[0][0]
      expect(call.body.filter?.from).toBeDefined()
      expect(call.body.filter?.to).toBeDefined()
    })

    it('should handle multiple groupBy fields', async () => {
      const mockApi = {
        aggregateLogs: vi.fn().mockResolvedValue({
          data: {
            buckets: [
              {
                by: { service: 'web-api', host: 'web-1' },
                computes: { c0: 100 }
              }
            ]
          }
        })
      } as unknown as v2.LogsApi

      const result = await aggregateLogs(
        mockApi,
        { query: '*', groupBy: ['service', 'host'] },
        defaultLimits,
        'datadoghq.com'
      )

      expect(result.buckets[0].by).toHaveProperty('service')
      expect(result.buckets[0].by).toHaveProperty('host')
    })

    it('should handle empty aggregation results', async () => {
      const mockApi = {
        aggregateLogs: vi.fn().mockResolvedValue({
          data: { buckets: [] }
        })
      } as unknown as v2.LogsApi

      const result = await aggregateLogs(
        mockApi,
        { query: '*', groupBy: ['service'] },
        defaultLimits,
        'datadoghq.com'
      )

      expect(result.buckets).toHaveLength(0)
    })

    it('should include Datadog URL in aggregation result', async () => {
      const mockApi = {
        aggregateLogs: vi.fn().mockResolvedValue({
          data: { buckets: [] }
        })
      } as unknown as v2.LogsApi

      const result = await aggregateLogs(
        mockApi,
        {
          query: 'test',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z',
          groupBy: ['service']
        },
        defaultLimits,
        'datadoghq.com'
      )

      expect(result.meta.datadog_url).toContain('datadoghq.com')
      expect(result.meta.datadog_url).toContain('logs')
    })
  })
})
