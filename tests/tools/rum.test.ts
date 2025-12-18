/**
 * Unit tests for the RUM tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { rum as rumFixtures } from '../helpers/fixtures.js'

describe('RUM Tool', () => {
  let api: v2.RUMApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v2.RUMApi(config)
  })

  describe('listRumApplications', () => {
    it('should list RUM applications successfully', async () => {
      server.use(
        http.get(endpoints.listRumApplications, () => {
          return jsonResponse(rumFixtures.applications)
        })
      )

      const response = await api.getRUMApplications()

      expect(response.data).toHaveLength(2)
      expect(response.data?.[0].attributes?.name).toBe('Production Web App')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listRumApplications, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(api.getRUMApplications()).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listRumApplications, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(api.getRUMApplications()).rejects.toMatchObject({
        code: 403
      })
    })
  })

  describe('searchRumEvents', () => {
    it('should search RUM events successfully', async () => {
      server.use(
        http.post(endpoints.listRumEvents, () => {
          return jsonResponse(rumFixtures.events)
        })
      )

      const response = await api.searchRUMEvents({
        body: {}
      })

      expect(response.data).toHaveLength(1)
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.listRumEvents, () => {
          return errorResponse(400, 'Invalid query')
        })
      )

      await expect(
        api.searchRUMEvents({
          body: {}
        })
      ).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('aggregateRumEvents', () => {
    it('should aggregate RUM events successfully', async () => {
      server.use(
        http.post(endpoints.aggregateRumEvents, () => {
          return jsonResponse(rumFixtures.aggregate)
        })
      )

      const response = await api.aggregateRUMEvents({
        body: {
          compute: [{ aggregation: 'count' }]
        }
      })

      expect(response.data).toBeDefined()
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.aggregateRumEvents, () => {
          return errorResponse(400, 'Invalid aggregation request')
        })
      )

      await expect(
        api.aggregateRUMEvents({
          body: {
            compute: [{ aggregation: 'count' }]
          }
        })
      ).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('performance (Core Web Vitals)', () => {
    it('should get performance metrics successfully', async () => {
      server.use(
        http.post(endpoints.aggregateRumEvents, () => {
          return jsonResponse(rumFixtures.performance)
        })
      )

      const response = await api.aggregateRUMEvents({
        body: {
          filter: { query: '@type:view' },
          compute: [
            { aggregation: 'avg', metric: '@view.largest_contentful_paint' },
            { aggregation: 'pc75', metric: '@view.largest_contentful_paint' },
            { aggregation: 'pc90', metric: '@view.largest_contentful_paint' }
          ]
        }
      })

      expect(response.data).toBeDefined()
      expect(response.data?.buckets).toHaveLength(1)
      expect(response.data?.buckets?.[0].computes).toBeDefined()
    })

    it('should handle performance metrics with groupBy', async () => {
      server.use(
        http.post(endpoints.aggregateRumEvents, () => {
          return jsonResponse({
            data: {
              buckets: [
                { by: { '@view.url_path': '/dashboard' }, computes: { c0: { value: 2500000000 } } },
                { by: { '@view.url_path': '/profile' }, computes: { c0: { value: 3500000000 } } }
              ]
            },
            meta: { elapsed: 150 }
          })
        })
      )

      const response = await api.aggregateRUMEvents({
        body: {
          filter: { query: '@type:view' },
          compute: [{ aggregation: 'avg', metric: '@view.largest_contentful_paint' }],
          groupBy: [{ facet: '@view.url_path', limit: 10 }]
        }
      })

      expect(response.data?.buckets).toHaveLength(2)
    })
  })

  describe('waterfall (session timeline)', () => {
    it('should get session waterfall successfully', async () => {
      server.use(
        http.get(endpoints.getRumEvents, () => {
          return jsonResponse(rumFixtures.waterfall)
        })
      )

      const response = await api.listRUMEvents({
        filterQuery: '@application.id:app-001 @session.id:session-001',
        sort: 'timestamp'
      })

      expect(response.data).toHaveLength(4)
      // Verify event types in waterfall - type is in nested attributes
      const types = response.data?.map((e) => {
        const attrs = e.attributes?.attributes as Record<string, unknown> | undefined
        return attrs?.type
      })
      expect(types).toContain('view')
      expect(types).toContain('resource')
      expect(types).toContain('action')
    })

    it('should filter waterfall by view ID', async () => {
      server.use(
        http.get(endpoints.getRumEvents, () => {
          return jsonResponse({
            data: rumFixtures.waterfall.data.filter(
              (e) => e.attributes?.attributes?.view?.id === 'view-001'
            )
          })
        })
      )

      const response = await api.listRUMEvents({
        filterQuery: '@application.id:app-001 @session.id:session-001 @view.id:view-001',
        sort: 'timestamp'
      })

      expect(response.data).toBeDefined()
      expect(
        response.data?.every(
          (e) => (e.attributes?.attributes as Record<string, unknown>)?.view?.id === 'view-001'
        )
      ).toBe(true)
    })

    it('should handle 400 bad request for invalid session', async () => {
      server.use(
        http.get(endpoints.getRumEvents, () => {
          return errorResponse(400, 'Invalid query')
        })
      )

      await expect(
        api.listRUMEvents({
          filterQuery: '@application.id:invalid @session.id:invalid'
        })
      ).rejects.toMatchObject({
        code: 400
      })
    })
  })
})
