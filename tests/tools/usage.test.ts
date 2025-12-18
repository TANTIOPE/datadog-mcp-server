/**
 * Unit tests for the usage tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { usage as usageFixtures } from '../helpers/fixtures.js'
import {
  getUsageSummary,
  getHostsUsage,
  getLogsUsage,
  getCustomMetricsUsage,
  getIndexedSpansUsage,
  getIngestedSpansUsage
} from '../../src/tools/usage.js'

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

      const result = await getUsageSummary(api, {
        from: '2024-01-01',
        to: '2024-01-31'
      })

      expect(result.startDate).toBeDefined()
      expect(result.usage).toBeDefined()
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.getUsageSummary, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(getUsageSummary(api, {})).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.getUsageSummary, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(getUsageSummary(api, {})).rejects.toMatchObject({
        code: 403
      })
    })
  })

  describe('getHostsUsage', () => {
    it('should get hosts usage successfully', async () => {
      server.use(
        http.get(endpoints.getUsageHosts, () => {
          return jsonResponse(usageFixtures.hosts)
        })
      )

      const result = await getHostsUsage(api, {
        from: '2024-01-01',
        to: '2024-01-02'
      })

      expect(result.usage).toBeDefined()
      expect(result.usage).toHaveLength(1)
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.get(endpoints.getUsageHosts, () => {
          return errorResponse(400, 'Invalid date range')
        })
      )

      await expect(getHostsUsage(api, {})).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('getLogsUsage', () => {
    it('should get logs usage successfully', async () => {
      server.use(
        http.get(endpoints.getUsageLogs, () => {
          return jsonResponse(usageFixtures.logs)
        })
      )

      const result = await getLogsUsage(api, {
        from: '2024-01-01'
      })

      expect(result.usage).toBeDefined()
      expect(result.usage).toHaveLength(1)
    })
  })

  describe('getCustomMetricsUsage', () => {
    it('should get custom metrics usage successfully', async () => {
      server.use(
        http.get(endpoints.getUsageTimeseries, () => {
          return jsonResponse(usageFixtures.timeseries)
        })
      )

      const result = await getCustomMetricsUsage(api, {
        from: '2024-01-01'
      })

      expect(result.usage).toBeDefined()
      expect(result.usage).toHaveLength(1)
    })
  })

  describe('getIndexedSpansUsage', () => {
    it('should get indexed spans usage successfully', async () => {
      server.use(
        http.get(endpoints.getUsageIndexedSpans, () => {
          return jsonResponse(usageFixtures.indexedSpans)
        })
      )

      const result = await getIndexedSpansUsage(api, {
        from: '2024-01-01'
      })

      expect(result.usage).toBeDefined()
      expect(result.usage).toHaveLength(1)
    })
  })

  describe('getIngestedSpansUsage', () => {
    it('should get ingested spans usage successfully', async () => {
      server.use(
        http.get(endpoints.getIngestedSpans, () => {
          return jsonResponse(usageFixtures.ingestedSpans)
        })
      )

      const result = await getIngestedSpansUsage(api, {
        from: '2024-01-01'
      })

      expect(result.usage).toBeDefined()
      expect(result.usage).toHaveLength(1)
    })
  })
})
