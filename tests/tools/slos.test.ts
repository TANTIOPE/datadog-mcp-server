/**
 * Unit tests for the SLOs tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { slos as fixtures } from '../helpers/fixtures.js'

describe('SLOs Tool', () => {
  let api: v1.ServiceLevelObjectivesApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v1.ServiceLevelObjectivesApi(config)
  })

  describe('listSLOs', () => {
    it('should list SLOs successfully', async () => {
      server.use(
        http.get(endpoints.listSlos, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const response = await api.listSLOs({})

      expect(response.data).toHaveLength(2)
      expect(response.data?.[0].id).toBe('slo-001')
      expect(response.data?.[0].name).toBe('API Availability')
      expect(response.data?.[0].type).toBe('metric')
    })

    it('should filter SLOs by tags', async () => {
      server.use(
        http.get(endpoints.listSlos, ({ request }) => {
          const url = new URL(request.url)
          const tagsQuery = url.searchParams.get('tags_query')

          if (tagsQuery?.includes('service:api')) {
            return jsonResponse({
              data: [fixtures.list.data[0]]
            })
          }
          return jsonResponse(fixtures.list)
        })
      )

      const response = await api.listSLOs({ tagsQuery: 'service:api' })

      expect(response.data).toHaveLength(1)
      expect(response.data?.[0].tags).toContain('service:api')
    })

    it('should filter SLOs by query', async () => {
      server.use(
        http.get(endpoints.listSlos, ({ request }) => {
          const url = new URL(request.url)
          const query = url.searchParams.get('query')

          if (query === 'Availability') {
            return jsonResponse({
              data: [fixtures.list.data[0]]
            })
          }
          return jsonResponse(fixtures.list)
        })
      )

      const response = await api.listSLOs({ query: 'Availability' })

      expect(response.data).toHaveLength(1)
      expect(response.data?.[0].name).toContain('Availability')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listSlos, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(api.listSLOs({})).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listSlos, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(api.listSLOs({})).rejects.toMatchObject({
        code: 403
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.listSlos, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(api.listSLOs({})).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('getSLO', () => {
    it('should get a single SLO by ID', async () => {
      server.use(
        http.get(endpoints.getSlo('slo-001'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const response = await api.getSLO({ sloId: 'slo-001' })

      expect(response.data?.id).toBe('slo-001')
      expect(response.data?.name).toBe('API Availability')
      expect(response.data?.thresholds?.[0].target).toBe(99.9)
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getSlo('nonexistent'), () => {
          return errorResponse(404, 'SLO not found')
        })
      )

      await expect(api.getSLO({ sloId: 'nonexistent' })).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('createSLO', () => {
    it('should create a new SLO', async () => {
      server.use(
        http.post(endpoints.createSlo, () => {
          return jsonResponse(fixtures.created)
        })
      )

      const response = await api.createSLO({
        body: {
          name: 'New SLO',
          type: 'metric',
          thresholds: [{ target: 99.9, timeframe: '30d' }],
          query: {
            numerator: 'sum:requests.success{*}.as_count()',
            denominator: 'sum:requests.total{*}.as_count()'
          }
        }
      })

      expect(response.data?.[0].id).toBe('slo-003')
      expect(response.data?.[0].name).toBe('New SLO')
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.createSlo, () => {
          return errorResponse(400, 'Invalid SLO configuration')
        })
      )

      await expect(api.createSLO({
        body: {
          name: 'Invalid SLO',
          type: 'metric',
          thresholds: []
        }
      })).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('updateSLO', () => {
    it('should update an existing SLO', async () => {
      server.use(
        http.put(endpoints.updateSlo('slo-001'), async ({ request }) => {
          const _body = await request.json() as Record<string, unknown>
          return jsonResponse({
            data: [{
              ...fixtures.single.data,
              name: 'Updated SLO Name'
            }]
          })
        })
      )

      const response = await api.updateSLO({
        sloId: 'slo-001',
        body: {
          name: 'Updated SLO Name',
          type: 'metric',
          thresholds: [{ target: 99.9, timeframe: '30d' }]
        }
      })

      expect(response.data?.[0].name).toBe('Updated SLO Name')
    })
  })

  describe('deleteSLO', () => {
    it('should delete an SLO', async () => {
      server.use(
        http.delete(endpoints.deleteSlo('slo-001'), () => {
          return jsonResponse({ data: ['slo-001'] })
        })
      )

      const response = await api.deleteSLO({ sloId: 'slo-001' })

      expect(response.data).toContain('slo-001')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.delete(endpoints.deleteSlo('nonexistent'), () => {
          return errorResponse(404, 'SLO not found')
        })
      )

      await expect(api.deleteSLO({ sloId: 'nonexistent' })).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('getSLOHistory', () => {
    it('should get SLO history', async () => {
      server.use(
        http.get(endpoints.getSloHistory('slo-001'), ({ request }) => {
          const url = new URL(request.url)
          const fromTs = url.searchParams.get('from_ts')
          const toTs = url.searchParams.get('to_ts')

          expect(fromTs).toBeTruthy()
          expect(toTs).toBeTruthy()

          return jsonResponse(fixtures.history)
        })
      )

      const response = await api.getSLOHistory({
        sloId: 'slo-001',
        fromTs: Math.floor(Date.now() / 1000) - 86400 * 7,
        toTs: Math.floor(Date.now() / 1000)
      })

      expect(response.data?.overall?.sliValue).toBe(99.95)
      expect(response.data?.series?.numerator?.values).toHaveLength(4)
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getSloHistory('nonexistent'), () => {
          return errorResponse(404, 'SLO not found')
        })
      )

      await expect(api.getSLOHistory({
        sloId: 'nonexistent',
        fromTs: Math.floor(Date.now() / 1000) - 86400,
        toTs: Math.floor(Date.now() / 1000)
      })).rejects.toMatchObject({
        code: 404
      })
    })
  })
})
