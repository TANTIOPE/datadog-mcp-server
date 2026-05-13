/**
 * Unit tests for the SLOs tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { slos as fixtures } from '../helpers/fixtures.js'
import {
  listSlos,
  getSlo,
  createSlo,
  updateSlo,
  deleteSlo,
  getSloHistory
} from '../../src/tools/slos.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

describe('SLOs Tool', () => {
  let api: v1.ServiceLevelObjectivesApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v1.ServiceLevelObjectivesApi(config)
  })

  describe('listSlos', () => {
    it('should list SLOs with status data via search API', async () => {
      server.use(
        http.get(endpoints.searchSlos, () => {
          return jsonResponse(fixtures.search)
        })
      )

      const result = await listSlos(api, {}, defaultLimits)

      expect(result.slos).toHaveLength(2)
      expect(result.slos[0].id).toBe('slo-001')
      expect(result.slos[0].name).toBe('API Availability')
      expect(result.slos[0].status.sli).toBe(99.95)
      expect(result.slos[0].status.errorBudgetRemaining).toBe(75.5)
      expect(result.slos[0].status.state).toBe('ok')
    })

    it('should return overall status per timeframe', async () => {
      server.use(
        http.get(endpoints.searchSlos, () => {
          return jsonResponse(fixtures.search)
        })
      )

      const result = await listSlos(api, {}, defaultLimits)

      expect(result.slos[1].overallStatus).toHaveLength(1)
      expect(result.slos[1].overallStatus[0].sli).toBe(98.2)
      expect(result.slos[1].overallStatus[0].errorBudgetRemaining).toBe(-26.0)
      expect(result.slos[1].overallStatus[0].state).toBe('breached')
      expect(result.slos[1].overallStatus[0].target).toBe(99.5)
      expect(result.slos[1].overallStatus[0].timeframe).toBe('7d')
    })

    it('should project query/monitorIds/groups via search response (issue #55)', async () => {
      server.use(
        http.get(endpoints.searchSlos, () => {
          return jsonResponse(fixtures.search)
        })
      )

      const result = await listSlos(api, {}, defaultLimits)

      // metric SLO carries query + groups
      expect(result.slos[0].query).toEqual({
        numerator: 'sum:requests.success{service:api}.as_count()',
        denominator: 'sum:requests.total{service:api}.as_count()'
      })
      expect(result.slos[0].groups).toEqual(['service:api'])
      expect(result.slos[0].monitorIds).toBeUndefined()

      // monitor SLO carries monitorIds only (search response omits monitor_tags)
      expect(result.slos[1].monitorIds).toEqual([12345, 12346])
      expect(result.slos[1].query).toBeUndefined()
      expect(result.slos[1].groups).toBeUndefined()
    })

    it('should filter SLOs by tags via search query', async () => {
      server.use(
        http.get(endpoints.searchSlos, ({ request }) => {
          const url = new URL(request.url)
          const query = url.searchParams.get('query')

          if (query?.includes('service:api')) {
            return jsonResponse({
              data: {
                attributes: {
                  slos: [fixtures.search.data.attributes.slos[0]]
                }
              }
            })
          }
          return jsonResponse(fixtures.search)
        })
      )

      const result = await listSlos(api, { tags: ['service:api'] }, defaultLimits)

      expect(result.slos).toHaveLength(1)
    })

    it('should filter SLOs by query via search API', async () => {
      server.use(
        http.get(endpoints.searchSlos, ({ request }) => {
          const url = new URL(request.url)
          const query = url.searchParams.get('query')

          if (query === 'Availability') {
            return jsonResponse({
              data: {
                attributes: {
                  slos: [fixtures.search.data.attributes.slos[0]]
                }
              }
            })
          }
          return jsonResponse(fixtures.search)
        })
      )

      const result = await listSlos(api, { query: 'Availability' }, defaultLimits)

      expect(result.slos).toHaveLength(1)
    })

    it('should fall back to listSLOs when filtering by IDs', async () => {
      server.use(
        http.get(endpoints.listSlos, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listSlos(api, { ids: ['slo-001'] }, defaultLimits)

      expect(result.slos).toHaveLength(2)
      expect(result.slos[0].id).toBe('slo-001')
      // Status is null when using listSLOs fallback (no status in that API response)
      expect(result.slos[0].status.sli).toBeNull()
    })

    it('should project query and monitorIds via the ids/listSLOs path', async () => {
      server.use(
        http.get(endpoints.listSlos, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listSlos(api, { ids: ['slo-001'] }, defaultLimits)

      expect(result.slos[0].query).toEqual({
        numerator: 'sum:requests.success{service:api}.as_count()',
        denominator: 'sum:requests.total{service:api}.as_count()'
      })
      expect(result.slos[1].monitorIds).toEqual([12345, 12346])
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.searchSlos, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listSlos(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.searchSlos, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(listSlos(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 403
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.searchSlos, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(listSlos(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('getSlo', () => {
    it('should get a single SLO by ID', async () => {
      server.use(
        http.get(endpoints.getSlo('slo-001'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getSlo(api, 'slo-001')

      expect(result.slo.id).toBe('slo-001')
      expect(result.slo.name).toBe('API Availability')
    })

    it('should project query for metric SLOs so update can round-trip (issue #55)', async () => {
      server.use(
        http.get(endpoints.getSlo('slo-001'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getSlo(api, 'slo-001')

      expect(result.slo.query).toEqual({
        numerator: 'sum:requests.success{service:api}.as_count()',
        denominator: 'sum:requests.total{service:api}.as_count()'
      })
      expect(result.slo.groups).toEqual(['service:api', 'service:gateway'])
      // monitorIds is only present on monitor SLOs.
      expect(result.slo.monitorIds).toBeUndefined()
    })

    it('should project monitorIds and monitorTags for monitor SLOs (issue #55)', async () => {
      server.use(
        http.get(endpoints.getSlo('slo-002'), () => {
          return jsonResponse(fixtures.singleMonitorBased)
        })
      )

      const result = await getSlo(api, 'slo-002')

      expect(result.slo.monitorIds).toEqual([12345, 12346])
      expect(result.slo.monitorTags).toEqual(['team:payments', 'tier:p99'])
      // query is only present on metric SLOs.
      expect(result.slo.query).toBeUndefined()
    })

    it('should omit round-trip fields when Datadog response does not include them', async () => {
      server.use(
        http.get(endpoints.getSlo('slo-bare'), () => {
          return jsonResponse({
            data: {
              id: 'slo-bare',
              name: 'Bare SLO',
              type: 'metric',
              thresholds: [{ target: 99, timeframe: '30d' }],
              tags: [],
              created_at: 1704067200,
              modified_at: 1705276800
            }
          })
        })
      )

      const result = await getSlo(api, 'slo-bare')

      expect(result.slo.query).toBeUndefined()
      expect(result.slo.monitorIds).toBeUndefined()
      expect(result.slo.groups).toBeUndefined()
      expect(result.slo.monitorTags).toBeUndefined()
    })

    it('should include a deep-link url field for the Datadog UI', async () => {
      server.use(
        http.get(endpoints.getSlo('slo-001'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getSlo(api, 'slo-001')
      expect(result.slo?.url).toBe('https://app.datadoghq.com/slo/slo-001')
    })

    it('should respect the configured Datadog site when building urls', async () => {
      server.use(
        http.get(endpoints.getSlo('slo-001'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getSlo(api, 'slo-001', 'datadoghq.eu')
      expect(result.slo?.url).toBe('https://app.datadoghq.eu/slo/slo-001')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getSlo('nonexistent'), () => {
          return errorResponse(404, 'SLO not found')
        })
      )

      await expect(getSlo(api, 'nonexistent')).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('createSlo', () => {
    it('should create a new SLO', async () => {
      server.use(
        http.post(endpoints.createSlo, () => {
          return jsonResponse(fixtures.created)
        })
      )

      const result = await createSlo(api, {
        name: 'New SLO',
        type: 'metric',
        thresholds: [{ target: 99.9, timeframe: '30d' }],
        query: {
          numerator: 'sum:requests.success{*}.as_count()',
          denominator: 'sum:requests.total{*}.as_count()'
        }
      })

      expect(result.success).toBe(true)
      expect(result.slo.id).toBe('slo-003')
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.createSlo, () => {
          return errorResponse(400, 'Invalid SLO configuration')
        })
      )

      await expect(
        createSlo(api, {
          name: 'Invalid SLO',
          type: 'metric',
          thresholds: []
        })
      ).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('updateSlo', () => {
    it('should update an existing SLO', async () => {
      server.use(
        http.put(endpoints.updateSlo('slo-001'), () => {
          return jsonResponse({
            data: [
              {
                ...fixtures.single.data,
                name: 'Updated SLO Name'
              }
            ]
          })
        })
      )

      const result = await updateSlo(api, 'slo-001', {
        name: 'Updated SLO Name',
        type: 'metric',
        thresholds: [{ target: 99.9, timeframe: '30d' }]
      })

      expect(result.success).toBe(true)
    })
  })

  describe('deleteSlo', () => {
    it('should delete an SLO', async () => {
      server.use(
        http.delete(endpoints.deleteSlo('slo-001'), () => {
          return jsonResponse({ data: ['slo-001'] })
        })
      )

      const result = await deleteSlo(api, 'slo-001')

      expect(result.success).toBe(true)
      expect(result.message).toContain('slo-001')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.delete(endpoints.deleteSlo('nonexistent'), () => {
          return errorResponse(404, 'SLO not found')
        })
      )

      await expect(deleteSlo(api, 'nonexistent')).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('getSloHistory', () => {
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

      const result = await getSloHistory(api, 'slo-001', {
        from: '7d',
        to: 'now'
      })

      expect(result.history).toBeDefined()
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getSloHistory('nonexistent'), () => {
          return errorResponse(404, 'SLO not found')
        })
      )

      await expect(
        getSloHistory(api, 'nonexistent', {
          from: '7d',
          to: 'now'
        })
      ).rejects.toMatchObject({
        code: 404
      })
    })
  })
})
