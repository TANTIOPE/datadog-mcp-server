/**
 * Unit tests for the traces tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { traces as fixtures } from '../helpers/fixtures.js'
import { searchTraces, aggregateTraces } from '../../src/tools/traces.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

const defaultSite = 'datadoghq.com'

describe('Traces Tool', () => {
  let api: v2.SpansApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v2.SpansApi(config)
  })

  describe('searchTraces', () => {
    it('should search spans successfully', async () => {
      server.use(
        http.post(endpoints.listSpans, () => {
          return jsonResponse(fixtures.search)
        })
      )

      const result = await searchTraces(
        api,
        {
          query: 'service:web-api',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z'
        },
        defaultLimits,
        defaultSite
      )

      expect(result.spans).toHaveLength(2)
      expect(result.spans[0].traceId).toBeDefined()
    })

    it('should filter spans by duration', async () => {
      server.use(
        http.post(endpoints.listSpans, async ({ request }) => {
          const body = (await request.json()) as {
            data?: { attributes?: { filter?: { query?: string } } }
          }
          const query = body.data?.attributes?.filter?.query ?? ''

          // Verify duration filter is in query
          expect(query).toContain('duration')
          return jsonResponse(fixtures.search)
        })
      )

      const result = await searchTraces(
        api,
        {
          query: 'service:web-api',
          minDuration: '100ms',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z'
        },
        defaultLimits,
        defaultSite
      )

      expect(result.spans).toBeDefined()
    })

    it('should filter spans by status', async () => {
      server.use(
        http.post(endpoints.listSpans, async ({ request }) => {
          const body = (await request.json()) as {
            data?: { attributes?: { filter?: { query?: string } } }
          }
          const query = body.data?.attributes?.filter?.query ?? ''

          expect(query).toContain('status:error')
          return jsonResponse({
            data: [fixtures.search.data[1]] // Only the error span
          })
        })
      )

      const result = await searchTraces(
        api,
        {
          status: 'error',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z'
        },
        defaultLimits,
        defaultSite
      )

      expect(result.spans).toHaveLength(1)
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.post(endpoints.listSpans, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(
        searchTraces(api, { query: '*' }, defaultLimits, defaultSite)
      ).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.post(endpoints.listSpans, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(
        searchTraces(api, { query: '*' }, defaultLimits, defaultSite)
      ).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('aggregateTraces', () => {
    it('should aggregate spans by service', async () => {
      server.use(
        http.post(endpoints.aggregateSpans, () => {
          // Response must match SDK's SpansAggregateResponse: data is Array<SpansAggregateBucket>
          return jsonResponse({
            data: [
              {
                id: 'bucket-1',
                type: 'bucket',
                attributes: {
                  by: { service: 'web-api' },
                  computes: { c0: 100 }
                }
              },
              {
                id: 'bucket-2',
                type: 'bucket',
                attributes: {
                  by: { service: 'auth' },
                  computes: { c0: 50 }
                }
              }
            ]
          })
        })
      )

      const result = await aggregateTraces(
        api,
        {
          query: '*',
          from: '2024-01-20T00:00:00Z',
          to: '2024-01-20T23:59:59Z',
          groupBy: ['service']
        },
        defaultLimits,
        defaultSite
      )

      expect(result.data).toHaveLength(2)
    })
  })
})
