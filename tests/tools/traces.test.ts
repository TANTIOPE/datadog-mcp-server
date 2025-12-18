/**
 * Unit tests for the traces tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { traces as fixtures } from '../helpers/fixtures.js'

describe('Traces Tool', () => {
  let api: v2.SpansApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v2.SpansApi(config)
  })

  describe('listSpans (search)', () => {
    it('should search spans successfully', async () => {
      server.use(
        http.post(endpoints.listSpans, () => {
          return jsonResponse(fixtures.search)
        })
      )

      const response = await api.listSpans({
        body: {
          data: {
            type: 'search_request',
            attributes: {
              filter: {
                query: 'service:web-api',
                from: '2024-01-20T00:00:00Z',
                to: '2024-01-20T23:59:59Z'
              },
              page: { limit: 100 }
            }
          }
        }
      })

      expect(response.data).toHaveLength(2)
      expect(response.data?.[0]?.id).toBe('span-001')
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

      const response = await api.listSpans({
        body: {
          data: {
            type: 'search_request',
            attributes: {
              filter: {
                query: 'service:web-api @duration:>100000000',
                from: '2024-01-20T00:00:00Z',
                to: '2024-01-20T23:59:59Z'
              }
            }
          }
        }
      })

      expect(response.data).toBeDefined()
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

      const response = await api.listSpans({
        body: {
          data: {
            type: 'search_request',
            attributes: {
              filter: {
                query: 'status:error',
                from: '2024-01-20T00:00:00Z',
                to: '2024-01-20T23:59:59Z'
              }
            }
          }
        }
      })

      expect(response.data).toHaveLength(1)
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.post(endpoints.listSpans, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(
        api.listSpans({
          body: {
            data: {
              type: 'search_request',
              attributes: {
                filter: { query: '*' }
              }
            }
          }
        })
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
        api.listSpans({
          body: {
            data: {
              type: 'search_request',
              attributes: {
                filter: { query: '*' }
              }
            }
          }
        })
      ).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('aggregateSpans', () => {
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

      const response = await api.aggregateSpans({
        body: {
          data: {
            type: 'aggregate_request',
            attributes: {
              filter: {
                query: '*',
                from: '2024-01-20T00:00:00Z',
                to: '2024-01-20T23:59:59Z'
              },
              compute: [{ aggregation: 'count' }],
              groupBy: [
                { facet: 'service', limit: 10, sort: { aggregation: 'count', order: 'desc' } }
              ]
            }
          }
        }
      })

      expect(response.data).toHaveLength(2)
      expect(response.data?.[0]?.attributes?.by?.service).toBe('web-api')
    })
  })
})
