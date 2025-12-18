/**
 * Unit tests for the RUM tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { rum as rumFixtures } from '../helpers/fixtures.js'
import {
  listApplications,
  searchEvents,
  aggregateEvents,
  getPerformanceMetrics,
  getSessionWaterfall
} from '../../src/tools/rum.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

const defaultSite = 'datadoghq.com'

describe('RUM Tool', () => {
  let api: v2.RUMApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v2.RUMApi(config)
  })

  describe('listApplications', () => {
    it('should list RUM applications successfully', async () => {
      server.use(
        http.get(endpoints.listRumApplications, () => {
          return jsonResponse(rumFixtures.applications)
        })
      )

      const result = await listApplications(api)

      expect(result.applications).toHaveLength(2)
      expect(result.applications[0].name).toBe('Production Web App')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listRumApplications, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listApplications(api)).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listRumApplications, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(listApplications(api)).rejects.toMatchObject({
        code: 403
      })
    })
  })

  describe('searchEvents', () => {
    it('should search RUM events successfully', async () => {
      server.use(
        http.get(endpoints.getRumEvents, () => {
          return jsonResponse(rumFixtures.events)
        })
      )

      const result = await searchEvents(api, {}, defaultLimits, defaultSite)

      expect(result.events).toHaveLength(1)
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.get(endpoints.getRumEvents, () => {
          return errorResponse(400, 'Invalid query')
        })
      )

      await expect(
        searchEvents(api, {}, defaultLimits, defaultSite)
      ).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('aggregateEvents', () => {
    it('should aggregate RUM events successfully', async () => {
      server.use(
        http.post(endpoints.aggregateRumEvents, () => {
          return jsonResponse(rumFixtures.aggregate)
        })
      )

      const result = await aggregateEvents(
        api,
        { compute: { aggregation: 'count' } },
        defaultLimits,
        defaultSite
      )

      expect(result.buckets).toBeDefined()
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.aggregateRumEvents, () => {
          return errorResponse(400, 'Invalid aggregation request')
        })
      )

      await expect(
        aggregateEvents(
          api,
          { compute: { aggregation: 'count' } },
          defaultLimits,
          defaultSite
        )
      ).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('getPerformanceMetrics (Core Web Vitals)', () => {
    it('should get performance metrics successfully', async () => {
      server.use(
        http.post(endpoints.aggregateRumEvents, () => {
          return jsonResponse(rumFixtures.performance)
        })
      )

      const result = await getPerformanceMetrics(
        api,
        { query: '@type:view' },
        defaultLimits,
        defaultSite
      )

      expect(result).toBeDefined()
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

      const result = await getPerformanceMetrics(
        api,
        {
          query: '@type:view',
          groupBy: ['@view.url_path']
        },
        defaultLimits,
        defaultSite
      )

      expect(result).toBeDefined()
    })
  })

  describe('getSessionWaterfall (session timeline)', () => {
    it('should get session waterfall successfully', async () => {
      server.use(
        http.get(endpoints.getRumEvents, () => {
          return jsonResponse(rumFixtures.waterfall)
        })
      )

      const result = await getSessionWaterfall(
        api,
        {
          applicationId: 'app-001',
          sessionId: 'session-001'
        },
        defaultSite
      )

      expect(result.events).toHaveLength(4)
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

      const result = await getSessionWaterfall(
        api,
        {
          applicationId: 'app-001',
          sessionId: 'session-001',
          viewId: 'view-001'
        },
        defaultSite
      )

      expect(result.events).toBeDefined()
    })

    it('should handle 400 bad request for invalid session', async () => {
      server.use(
        http.get(endpoints.getRumEvents, () => {
          return errorResponse(400, 'Invalid query')
        })
      )

      await expect(
        getSessionWaterfall(
          api,
          {
            applicationId: 'invalid',
            sessionId: 'invalid'
          },
          defaultSite
        )
      ).rejects.toMatchObject({
        code: 400
      })
    })
  })
})
