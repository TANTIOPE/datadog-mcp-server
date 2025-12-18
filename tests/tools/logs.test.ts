/**
 * Unit tests for the logs tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { logs as fixtures } from '../helpers/fixtures.js'

describe('Logs Tool', () => {
  let api: v2.LogsApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v2.LogsApi(config)
  })

  describe('listLogs (search)', () => {
    it('should search logs successfully', async () => {
      server.use(
        http.post(endpoints.listLogs, () => {
          return jsonResponse(fixtures.search)
        })
      )

      const response = await api.listLogs({
        body: {
          filter: {
            query: 'service:web-api status:error',
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z'
          },
          page: { limit: 100 }
        }
      })

      expect(response.data).toHaveLength(2)
      expect(response.data?.[0]?.id).toBe('log-001')
      expect(response.data?.[0]?.attributes?.status).toBe('error')
    })

    it('should search logs with keyword filter', async () => {
      server.use(
        http.post(endpoints.listLogs, async ({ request }) => {
          const body = await request.json() as { filter?: { query?: string } }
          const query = body.filter?.query ?? ''

          // Verify the query includes the keyword
          expect(query).toContain('timeout')
          return jsonResponse(fixtures.search)
        })
      )

      const response = await api.listLogs({
        body: {
          filter: {
            query: '"timeout"',
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z'
          }
        }
      })

      expect(response.data).toBeDefined()
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.post(endpoints.listLogs, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(api.listLogs({
        body: { filter: { query: '*' } }
      })).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.post(endpoints.listLogs, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(api.listLogs({
        body: { filter: { query: '*' } }
      })).rejects.toMatchObject({
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

      const response = await api.aggregateLogs({
        body: {
          filter: {
            query: 'status:error',
            from: '2024-01-20T00:00:00Z',
            to: '2024-01-20T23:59:59Z'
          },
          compute: [{ aggregation: 'count' }],
          groupBy: [{ facet: 'service', limit: 10, sort: { aggregation: 'count', order: 'desc' } }]
        }
      })

      expect(response.data?.buckets).toHaveLength(2)
    })

    it('should handle 400 bad request for invalid query', async () => {
      server.use(
        http.post(endpoints.aggregateLogs, () => {
          return errorResponse(400, 'Invalid query syntax')
        })
      )

      await expect(api.aggregateLogs({
        body: {
          filter: { query: 'invalid[query' },
          compute: [{ aggregation: 'count' }]
        }
      })).rejects.toMatchObject({
        code: 400
      })
    })
  })
})
