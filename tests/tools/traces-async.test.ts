/**
 * Comprehensive async tests for traces.ts
 * Focuses on listApmServices (completely untested) and additional edge cases
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { listApmServices } from '../../src/tools/traces.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24,
  defaultLimit: 25
}

describe('Traces Async Functions', () => {
  describe('listApmServices', () => {
    it('should list APM services from span aggregation', async () => {
      const mockApi = {
        aggregateSpans: vi.fn().mockResolvedValue({
          data: [
            {
              attributes: {
                by: { service: 'web-api' },
                computes: { c0: 1000 }
              }
            },
            {
              attributes: {
                by: { service: 'auth-service' },
                computes: { c0: 500 }
              }
            }
          ]
        })
      } as unknown as v2.SpansApi

      const result = await listApmServices(mockApi, {}, defaultLimits)

      expect(mockApi.aggregateSpans).toHaveBeenCalledTimes(1)
      expect(result.services).toHaveLength(2)
      expect(result.services[0]).toEqual({ name: 'web-api', spanCount: 1000 })
      expect(result.services[1]).toEqual({ name: 'auth-service', spanCount: 500 })
      expect(result.total).toBe(2)
    })

    it('should filter by environment', async () => {
      const mockApi = {
        aggregateSpans: vi.fn().mockResolvedValue({
          data: [
            {
              attributes: {
                by: { service: 'web-api' },
                computes: { c0: 1000 }
              }
            }
          ]
        })
      } as unknown as v2.SpansApi

      const result = await listApmServices(
        mockApi,
        { env: 'production' },
        defaultLimits
      )

      const call = mockApi.aggregateSpans.mock.calls[0][0]
      expect(call.body.data?.attributes?.filter?.query).toBe('env:production')
      expect(result.meta.env).toBe('production')
    })

    it('should use wildcard query when no env specified', async () => {
      const mockApi = {
        aggregateSpans: vi.fn().mockResolvedValue({
          data: []
        })
      } as unknown as v2.SpansApi

      const result = await listApmServices(mockApi, {}, defaultLimits)

      const call = mockApi.aggregateSpans.mock.calls[0][0]
      expect(call.body.data?.attributes?.filter?.query).toBe('*')
      expect(result.meta.env).toBe('all')
    })

    it('should set time range from params', async () => {
      const mockApi = {
        aggregateSpans: vi.fn().mockResolvedValue({
          data: []
        })
      } as unknown as v2.SpansApi

      await listApmServices(
        mockApi,
        {
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z'
        },
        defaultLimits
      )

      const call = mockApi.aggregateSpans.mock.calls[0][0]
      expect(call.body.data?.attributes?.filter?.from).toBeDefined()
      expect(call.body.data?.attributes?.filter?.to).toBeDefined()
    })

    it('should use default 24-hour time range when not provided', async () => {
      const mockApi = {
        aggregateSpans: vi.fn().mockResolvedValue({
          data: []
        })
      } as unknown as v2.SpansApi

      await listApmServices(mockApi, {}, defaultLimits)

      const call = mockApi.aggregateSpans.mock.calls[0][0]
      expect(call.body.data?.attributes?.filter?.from).toBeDefined()
      expect(call.body.data?.attributes?.filter?.to).toBeDefined()
    })

    it('should respect maxResults limit for service discovery', async () => {
      const limits = { ...defaultLimits, maxResults: 50 }

      const mockApi = {
        aggregateSpans: vi.fn().mockResolvedValue({
          data: []
        })
      } as unknown as v2.SpansApi

      await listApmServices(mockApi, {}, limits)

      const call = mockApi.aggregateSpans.mock.calls[0][0]
      expect(call.body.data?.attributes?.groupBy?.[0]?.limit).toBe(50)
    })

    it('should handle empty service list', async () => {
      const mockApi = {
        aggregateSpans: vi.fn().mockResolvedValue({
          data: []
        })
      } as unknown as v2.SpansApi

      const result = await listApmServices(mockApi, {}, defaultLimits)

      expect(result.services).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it('should filter out services with empty names', async () => {
      const mockApi = {
        aggregateSpans: vi.fn().mockResolvedValue({
          data: [
            {
              attributes: {
                by: { service: 'web-api' },
                computes: { c0: 1000 }
              }
            },
            {
              attributes: {
                by: { service: '' }, // Empty service name
                computes: { c0: 100 }
              }
            },
            {
              attributes: {
                // Missing 'by' field
                computes: { c0: 50 }
              }
            }
          ]
        })
      } as unknown as v2.SpansApi

      const result = await listApmServices(mockApi, {}, defaultLimits)

      // Only the valid service should be included
      expect(result.services).toHaveLength(1)
      expect(result.services[0].name).toBe('web-api')
      expect(result.total).toBe(1)
    })

    it('should handle buckets without computes', async () => {
      const mockApi = {
        aggregateSpans: vi.fn().mockResolvedValue({
          data: [
            {
              attributes: {
                by: { service: 'web-api' }
                // Missing computes
              }
            }
          ]
        })
      } as unknown as v2.SpansApi

      const result = await listApmServices(mockApi, {}, defaultLimits)

      expect(result.services).toHaveLength(1)
      expect(result.services[0].spanCount).toBe(0) // Default to 0
    })

    it('should handle undefined response data', async () => {
      const mockApi = {
        aggregateSpans: vi.fn().mockResolvedValue({
          data: undefined
        })
      } as unknown as v2.SpansApi

      const result = await listApmServices(mockApi, {}, defaultLimits)

      expect(result.services).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it('should include query and time range in meta', async () => {
      const mockApi = {
        aggregateSpans: vi.fn().mockResolvedValue({
          data: []
        })
      } as unknown as v2.SpansApi

      const result = await listApmServices(
        mockApi,
        {
          env: 'staging',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z'
        },
        defaultLimits
      )

      expect(result.meta.query).toBe('env:staging')
      expect(result.meta.env).toBe('staging')
      expect(result.meta.from).toBeDefined()
      expect(result.meta.to).toBeDefined()
    })

    it('should aggregate multiple services correctly', async () => {
      const mockApi = {
        aggregateSpans: vi.fn().mockResolvedValue({
          data: [
            {
              attributes: {
                by: { service: 'web-api' },
                computes: { c0: 1000 }
              }
            },
            {
              attributes: {
                by: { service: 'auth-service' },
                computes: { c0: 500 }
              }
            },
            {
              attributes: {
                by: { service: 'payment-service' },
                computes: { c0: 300 }
              }
            }
          ]
        })
      } as unknown as v2.SpansApi

      const result = await listApmServices(mockApi, { env: 'production' }, defaultLimits)

      expect(result.services).toHaveLength(3)
      expect(result.total).toBe(3)

      // Verify all services are present
      const serviceNames = result.services.map(s => s.name)
      expect(serviceNames).toContain('web-api')
      expect(serviceNames).toContain('auth-service')
      expect(serviceNames).toContain('payment-service')
    })
  })
})
