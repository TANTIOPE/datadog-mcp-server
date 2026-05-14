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
  getMetricMetadata,
  parseRollupFromQuery
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

    describe('rollup override metadata', () => {
      it('reports requested and effective rollup when intervals match', async () => {
        server.use(
          http.get(endpoints.queryMetrics, () => {
            // Existing fixtures.query series uses 60s spacing (1705750800000, 1705750860000, ...)
            return jsonResponse(fixtures.query)
          })
        )

        const result = await queryMetrics(
          api,
          {
            query: 'avg:system.cpu.user{*}.rollup(avg, 60)',
            from: '1h',
            to: 'now'
          },
          defaultLimits,
          defaultSite
        )

        expect(result.meta.rollupRequested).toEqual({
          interval: 60,
          method: 'avg',
          methodInferred: false
        })
        expect(result.meta.rollupEffective).toEqual({ interval: 60 })
        expect(result.meta.rollupOverridden).toBe(false)
      })

      it('flags rollupOverridden=true when Datadog re-rolls the series', async () => {
        server.use(
          http.get(endpoints.queryMetrics, () => {
            return jsonResponse(fixtures.queryRollupOverridden)
          })
        )

        const result = await queryMetrics(
          api,
          {
            query: 'avg:system.cpu.user{*}.rollup(sum, 900)',
            from: '7d',
            to: 'now'
          },
          defaultLimits,
          defaultSite
        )

        expect(result.meta.rollupRequested).toEqual({
          interval: 900,
          method: 'sum',
          methodInferred: false
        })
        expect(result.meta.rollupEffective).toEqual({ interval: 3600 })
        expect(result.meta.rollupOverridden).toBe(true)
      })

      it('flags methodInferred=true when only the interval is given', async () => {
        server.use(
          http.get(endpoints.queryMetrics, () => {
            return jsonResponse(fixtures.query)
          })
        )

        const result = await queryMetrics(
          api,
          {
            query: 'avg:system.cpu.user{*}.rollup(60)',
            from: '1h',
            to: 'now'
          },
          defaultLimits,
          defaultSite
        )

        expect(result.meta.rollupRequested?.methodInferred).toBe(true)
        expect(result.meta.rollupRequested?.interval).toBe(60)
      })

      it('returns intervalsObserved for multi-series with mixed intervals', async () => {
        server.use(
          http.get(endpoints.queryMetrics, () => {
            return jsonResponse(fixtures.queryRollupMixedIntervals)
          })
        )

        const result = await queryMetrics(
          api,
          {
            query: 'avg:system.cpu.user{*}.rollup(avg, 900)',
            from: '7d',
            to: 'now'
          },
          defaultLimits,
          defaultSite
        )

        expect(result.meta.rollupOverridden).toBe(true)
        // `interval` echoes the first observed series interval; the full set is
        // surfaced via `intervalsObserved` (deduped + sorted ascending).
        expect(result.meta.rollupEffective?.interval).toBe(3600)
        expect(result.meta.rollupEffective?.intervalsObserved).toEqual([900, 3600])
      })

      it('returns null rollupRequested for queries without rollup', async () => {
        server.use(
          http.get(endpoints.queryMetrics, () => {
            return jsonResponse(fixtures.query)
          })
        )

        const result = await queryMetrics(
          api,
          {
            query: 'avg:system.cpu.user{*}',
            from: '1h',
            to: 'now'
          },
          defaultLimits,
          defaultSite
        )

        expect(result.meta.rollupRequested).toBeNull()
        expect(result.meta.rollupOverridden).toBe(false)
      })

      it('treats malformed rollup substring as no rollup', async () => {
        server.use(
          http.get(endpoints.queryMetrics, () => {
            return jsonResponse(fixtures.query)
          })
        )

        const result = await queryMetrics(
          api,
          {
            query: 'avg:system.cpu.user{*}.rollup(garbage)',
            from: '1h',
            to: 'now'
          },
          defaultLimits,
          defaultSite
        )

        expect(result.meta.rollupRequested).toBeNull()
        expect(result.meta.rollupOverridden).toBe(false)
      })

      it('preserves existing top-level response keys', async () => {
        server.use(
          http.get(endpoints.queryMetrics, () => {
            return jsonResponse(fixtures.query)
          })
        )

        const result = await queryMetrics(
          api,
          {
            query: 'avg:system.cpu.user{*}',
            from: '1h',
            to: 'now'
          },
          defaultLimits,
          defaultSite
        )

        expect(result.series).toBeDefined()
        expect(result.meta.query).toBe('avg:system.cpu.user{*}')
        expect(result.meta.seriesCount).toBe(1)
        expect(result.meta.datadog_url).toContain('app.datadoghq.com')
      })
    })
  })

  describe('parseRollupFromQuery', () => {
    it('extracts method and interval from "rollup(sum, 900)"', () => {
      expect(parseRollupFromQuery('avg:cpu{*}.rollup(sum, 900)')).toEqual({
        interval: 900,
        method: 'sum',
        methodInferred: false
      })
    })

    it('tolerates whitespace inside the rollup call', () => {
      expect(parseRollupFromQuery('avg:cpu{*}.rollup( avg ,  60 )')).toEqual({
        interval: 60,
        method: 'avg',
        methodInferred: false
      })
    })

    it('defaults the method when only an interval is given', () => {
      expect(parseRollupFromQuery('avg:cpu{*}.rollup(120)')).toEqual({
        interval: 120,
        method: 'avg',
        methodInferred: true
      })
    })

    it('returns null when the query has no rollup', () => {
      expect(parseRollupFromQuery('avg:cpu{*}')).toBeNull()
    })

    it('returns null on malformed rollup substring', () => {
      expect(parseRollupFromQuery('avg:cpu{*}.rollup(garbage)')).toBeNull()
      expect(parseRollupFromQuery('avg:cpu{*}.rollup()')).toBeNull()
      expect(parseRollupFromQuery('avg:cpu{*}.rollup(sum, nope)')).toBeNull()
    })

    it('handles nested expressions like default_zero().rollup(sum, 900)', () => {
      expect(parseRollupFromQuery('default_zero(avg:cpu{*}).rollup(sum, 900).as_count()')).toEqual({
        interval: 900,
        method: 'sum',
        methodInferred: false
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
