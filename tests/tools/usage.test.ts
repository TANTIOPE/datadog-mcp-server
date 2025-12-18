/**
 * Unit tests for the usage tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { usage as usageFixtures } from '../helpers/fixtures.js'

describe('Usage Tool', () => {
  let api: v1.UsageMeteringApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v1.UsageMeteringApi(config)
  })

  describe('getUsageSummary', () => {
    it('should get usage summary successfully', async () => {
      server.use(
        http.get(endpoints.getUsageSummary, () => {
          return jsonResponse(usageFixtures.summary)
        })
      )

      const response = await api.getUsageSummary({
        startMonth: new Date('2024-01-01'),
        endMonth: new Date('2024-01-31')
      })

      expect(response.startDate).toBeDefined()
      expect(response.usage).toBeDefined()
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.getUsageSummary, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(api.getUsageSummary({
        startMonth: new Date()
      })).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.getUsageSummary, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(api.getUsageSummary({
        startMonth: new Date()
      })).rejects.toMatchObject({
        code: 403
      })
    })
  })

  describe('getUsageHosts', () => {
    it('should get hosts usage successfully', async () => {
      server.use(
        http.get(endpoints.getUsageHosts, () => {
          return jsonResponse(usageFixtures.hosts)
        })
      )

      const response = await api.getUsageHosts({
        startHr: new Date('2024-01-01'),
        endHr: new Date('2024-01-02')
      })

      expect(response.usage).toBeDefined()
      expect(response.usage).toHaveLength(1)
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.get(endpoints.getUsageHosts, () => {
          return errorResponse(400, 'Invalid date range')
        })
      )

      await expect(api.getUsageHosts({
        startHr: new Date()
      })).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('getUsageLogs', () => {
    it('should get logs usage successfully', async () => {
      server.use(
        http.get(endpoints.getUsageLogs, () => {
          return jsonResponse(usageFixtures.logs)
        })
      )

      const response = await api.getUsageLogs({
        startHr: new Date('2024-01-01')
      })

      expect(response.usage).toBeDefined()
      expect(response.usage).toHaveLength(1)
    })
  })

  describe('getUsageTimeseries', () => {
    it('should get custom metrics usage successfully', async () => {
      server.use(
        http.get(endpoints.getUsageTimeseries, () => {
          return jsonResponse(usageFixtures.timeseries)
        })
      )

      const response = await api.getUsageTimeseries({
        startHr: new Date('2024-01-01')
      })

      expect(response.usage).toBeDefined()
      expect(response.usage).toHaveLength(1)
    })
  })

  describe('getUsageIndexedSpans', () => {
    it('should get indexed spans usage successfully', async () => {
      server.use(
        http.get(endpoints.getUsageIndexedSpans, () => {
          return jsonResponse(usageFixtures.indexedSpans)
        })
      )

      const response = await api.getUsageIndexedSpans({
        startHr: new Date('2024-01-01')
      })

      expect(response.usage).toBeDefined()
      expect(response.usage).toHaveLength(1)
    })
  })

  describe('getIngestedSpans', () => {
    it('should get ingested spans usage successfully', async () => {
      server.use(
        http.get(endpoints.getIngestedSpans, () => {
          return jsonResponse(usageFixtures.ingestedSpans)
        })
      )

      const response = await api.getIngestedSpans({
        startHr: new Date('2024-01-01')
      })

      expect(response.usage).toBeDefined()
      expect(response.usage).toHaveLength(1)
    })
  })
})
