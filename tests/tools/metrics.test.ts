/**
 * Unit tests for the metrics tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { metrics as fixtures } from '../helpers/fixtures.js'
import {
  queryMetrics,
  searchMetrics,
  listMetrics,
  getMetricMetadata
} from '../../src/tools/metrics.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

const defaultSite = 'datadoghq.com'

describe('Metrics Tool', () => {
  let api: v1.MetricsApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v1.MetricsApi(config)
  })

  describe('queryMetrics', () => {
    it('should query metrics successfully', async () => {
      server.use(
        http.get(endpoints.queryMetrics, ({ request }) => {
          const url = new URL(request.url)
          const query = url.searchParams.get('query')

          expect(query).toContain('system.cpu.user')
          return jsonResponse(fixtures.query)
        })
      )

      const result = await queryMetrics(
        api,
        { query: 'avg:system.cpu.user{*}', from: '1h', to: 'now' },
        defaultLimits,
        defaultSite
      )

      expect(result.series).toHaveLength(1)
      expect(result.series[0].metric).toBe('system.cpu.user')
    })

    it('should handle 400 bad request for invalid query', async () => {
      server.use(
        http.get(endpoints.queryMetrics, () => {
          return errorResponse(400, 'Invalid metric query')
        })
      )

      await expect(
        queryMetrics(api, { query: 'invalid:query' }, defaultLimits, defaultSite)
      ).rejects.toMatchObject({
        code: 400
      })
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.queryMetrics, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(
        queryMetrics(api, { query: 'avg:system.cpu.user{*}' }, defaultLimits, defaultSite)
      ).rejects.toMatchObject({
        code: 401
      })
    })
  })

  describe('listMetrics', () => {
    it('should list active metrics', async () => {
      server.use(
        http.get(endpoints.listMetrics, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listMetrics(api, {}, defaultLimits)

      expect(result.metrics).toContain('system.cpu.user')
    })
  })

  describe('searchMetrics', () => {
    it('should search metrics by query', async () => {
      server.use(
        http.get(endpoints.listMetrics, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await searchMetrics(api, { query: 'cpu' }, defaultLimits)

      expect(result.metrics).toBeDefined()
    })
  })

  describe('getMetricMetadata', () => {
    it('should get metric metadata', async () => {
      server.use(
        http.get(endpoints.getMetricMetadata('system.cpu.user'), () => {
          return jsonResponse(fixtures.metadata)
        })
      )

      const result = await getMetricMetadata(api, 'system.cpu.user')

      expect(result.type).toBe('gauge')
      expect(result.unit).toBe('percent')
    })

    it('should handle 404 not found for unknown metric', async () => {
      server.use(
        http.get(endpoints.getMetricMetadata('unknown.metric'), () => {
          return errorResponse(404, 'Metric not found')
        })
      )

      await expect(getMetricMetadata(api, 'unknown.metric')).rejects.toMatchObject({
        code: 404
      })
    })
  })
})
