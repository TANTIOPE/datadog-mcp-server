/**
 * Unit tests for the metrics tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { metrics as fixtures } from '../helpers/fixtures.js'

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

      const now = Math.floor(Date.now() / 1000)
      const response = await api.queryMetrics({
        from: now - 3600,
        to: now,
        query: 'avg:system.cpu.user{*}'
      })

      expect(response.series).toHaveLength(1)
      expect(response.series?.[0]?.metric).toBe('system.cpu.user')
      expect(response.series?.[0]?.pointlist).toHaveLength(3)
    })

    it('should handle 400 bad request for invalid query', async () => {
      server.use(
        http.get(endpoints.queryMetrics, () => {
          return errorResponse(400, 'Invalid metric query')
        })
      )

      const now = Math.floor(Date.now() / 1000)
      await expect(api.queryMetrics({
        from: now - 3600,
        to: now,
        query: 'invalid:query'
      })).rejects.toMatchObject({
        code: 400
      })
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.queryMetrics, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      const now = Math.floor(Date.now() / 1000)
      await expect(api.queryMetrics({
        from: now - 3600,
        to: now,
        query: 'avg:system.cpu.user{*}'
      })).rejects.toMatchObject({
        code: 401
      })
    })
  })

  describe('listActiveMetrics', () => {
    it('should list active metrics', async () => {
      server.use(
        http.get(endpoints.listMetrics, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const response = await api.listActiveMetrics({
        from: Math.floor(Date.now() / 1000) - 3600
      })

      expect(response.metrics).toContain('system.cpu.user')
      expect(response.metrics).toHaveLength(4)
    })
  })

  describe('searchMetrics', () => {
    it('should search metrics by query', async () => {
      server.use(
        http.get(endpoints.searchMetrics, ({ request }) => {
          const url = new URL(request.url)
          const q = url.searchParams.get('q')

          expect(q).toContain('cpu')
          return jsonResponse(fixtures.search)
        })
      )

      const response = await api.listMetrics({ q: 'metrics:cpu' })

      expect(response.results?.metrics).toHaveLength(2)
      expect(response.results?.metrics?.[0]).toContain('cpu')
    })
  })

  describe('getMetricMetadata', () => {
    it('should get metric metadata', async () => {
      server.use(
        http.get(endpoints.getMetricMetadata('system.cpu.user'), () => {
          return jsonResponse(fixtures.metadata)
        })
      )

      const response = await api.getMetricMetadata({ metricName: 'system.cpu.user' })

      expect(response.type).toBe('gauge')
      expect(response.unit).toBe('percent')
    })

    it('should handle 404 not found for unknown metric', async () => {
      server.use(
        http.get(endpoints.getMetricMetadata('unknown.metric'), () => {
          return errorResponse(404, 'Metric not found')
        })
      )

      await expect(api.getMetricMetadata({ metricName: 'unknown.metric' })).rejects.toMatchObject({
        code: 404
      })
    })
  })
})
