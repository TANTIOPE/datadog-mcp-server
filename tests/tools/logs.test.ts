/**
 * Unit tests for the logs tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { logs as fixtures } from '../helpers/fixtures.js'
import { searchLogs, aggregateLogs } from '../../src/tools/logs.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24,
  defaultLimit: 100
}

const defaultSite = 'datadoghq.com'

describe('Logs Tool', () => {
  let api: v2.LogsApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v2.LogsApi(config)
  })

  describe('searchLogs', () => {
    it('should search logs successfully', async () => {
      server.use(
        http.post(endpoints.listLogs, () => {
          return jsonResponse(fixtures.search)
        })
      )

      const result = await searchLogs(
        api,
        {
          query: 'service:web-api status:error',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z'
        },
        defaultLimits,
        defaultSite
      )

      expect(result.logs).toHaveLength(2)
      expect(result.logs[0].id).toBe('log-001')
      expect(result.logs[0].status).toBe('error')
    })

    it('should search logs with keyword filter', async () => {
      server.use(
        http.post(endpoints.listLogs, async ({ request }) => {
          const body = (await request.json()) as { filter?: { query?: string } }
          const query = body.filter?.query ?? ''

          // Verify the query includes the keyword
          expect(query).toContain('timeout')
          return jsonResponse(fixtures.search)
        })
      )

      const result = await searchLogs(
        api,
        {
          keyword: 'timeout',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z'
        },
        defaultLimits,
        defaultSite
      )

      expect(result.logs).toBeDefined()
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.post(endpoints.listLogs, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(
        searchLogs(api, { query: '*' }, defaultLimits, defaultSite)
      ).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.post(endpoints.listLogs, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(
        searchLogs(api, { query: '*' }, defaultLimits, defaultSite)
      ).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('aggregateLogs', () => {
    it('should aggregate logs by service', async () => {
      server.use(
        http.post(endpoints.aggregateLogs, () => {
          return jsonResponse(fixtures.aggregate)
        })
      )

      const result = await aggregateLogs(
        api,
        {
          query: 'status:error',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z',
          groupBy: ['service']
        },
        defaultLimits,
        defaultSite
      )

      expect(result.buckets).toHaveLength(2)
    })

    it('should handle 400 bad request for invalid query', async () => {
      server.use(
        http.post(endpoints.aggregateLogs, () => {
          return errorResponse(400, 'Invalid query syntax')
        })
      )

      await expect(
        aggregateLogs(
          api,
          {
            query: 'invalid[query',
            groupBy: ['service']
          },
          defaultLimits,
          defaultSite
        )
      ).rejects.toMatchObject({
        code: 400
      })
    })
  })
})
