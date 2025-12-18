/**
 * Unit tests for the downtimes tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v2 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { downtimes as fixtures } from '../helpers/fixtures.js'
import {
  listDowntimes,
  getDowntime,
  createDowntime,
  updateDowntime,
  cancelDowntime,
  listMonitorDowntimes
} from '../../src/tools/downtimes.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

describe('Downtimes Tool', () => {
  let api: v2.DowntimesApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v2.DowntimesApi(config)
  })

  describe('listDowntimes', () => {
    it('should list downtimes successfully', async () => {
      server.use(
        http.get(endpoints.listDowntimes, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listDowntimes(api, {}, defaultLimits)

      expect(result.downtimes).toHaveLength(2)
      expect(result.downtimes[0].id).toBe('dt-001')
      expect(result.downtimes[0].status).toBe('active')
    })

    it('should filter by currentOnly', async () => {
      server.use(
        http.get(endpoints.listDowntimes, ({ request }) => {
          const url = new URL(request.url)
          const currentOnly = url.searchParams.get('current_only')

          if (currentOnly === 'true') {
            return jsonResponse({
              data: [fixtures.list.data[0]]
            })
          }
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listDowntimes(api, { currentOnly: true }, defaultLimits)

      expect(result.downtimes).toHaveLength(1)
      expect(result.downtimes[0].status).toBe('active')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listDowntimes, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listDowntimes(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listDowntimes, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(listDowntimes(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 403
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.listDowntimes, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(listDowntimes(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('getDowntime', () => {
    it('should get a single downtime by ID', async () => {
      server.use(
        http.get(endpoints.getDowntime('dt-001'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getDowntime(api, 'dt-001')

      expect(result.downtime.id).toBe('dt-001')
      expect(result.downtime.scope).toBe('env:production')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getDowntime('nonexistent'), () => {
          return errorResponse(404, 'Downtime not found')
        })
      )

      await expect(getDowntime(api, 'nonexistent')).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('createDowntime', () => {
    it('should create a new downtime', async () => {
      server.use(
        http.post(endpoints.createDowntime, () => {
          return jsonResponse(fixtures.created)
        })
      )

      const result = await createDowntime(api, {
        scope: 'env:staging',
        monitorIdentifier: {
          monitorTags: ['env:staging']
        },
        schedule: {
          start: new Date().toISOString()
        }
      })

      expect(result.success).toBe(true)
      expect(result.downtime.id).toBe('dt-003')
      expect(result.downtime.scope).toBe('env:staging')
    })

    it('should handle 400 bad request error', async () => {
      server.use(
        http.post(endpoints.createDowntime, () => {
          return errorResponse(400, 'Invalid scope format')
        })
      )

      await expect(
        createDowntime(api, {
          scope: 'invalid',
          monitorIdentifier: {
            monitorTags: ['invalid']
          }
        })
      ).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('updateDowntime', () => {
    it('should update an existing downtime', async () => {
      server.use(
        http.patch(endpoints.updateDowntime('dt-001'), async () => {
          return jsonResponse({
            data: {
              ...fixtures.single.data,
              attributes: {
                ...fixtures.single.data.attributes,
                message: 'Updated message'
              }
            }
          })
        })
      )

      const result = await updateDowntime(api, 'dt-001', {
        message: 'Updated message'
      })

      expect(result.success).toBe(true)
    })
  })

  describe('cancelDowntime', () => {
    it('should cancel a downtime', async () => {
      server.use(
        http.delete(endpoints.cancelDowntime('dt-001'), () => {
          return new Response(null, { status: 204 })
        })
      )

      const result = await cancelDowntime(api, 'dt-001')

      expect(result.success).toBe(true)
      expect(result.message).toContain('dt-001')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.delete(endpoints.cancelDowntime('nonexistent'), () => {
          return errorResponse(404, 'Downtime not found')
        })
      )

      await expect(cancelDowntime(api, 'nonexistent')).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('listMonitorDowntimes', () => {
    it('should list downtimes for a specific monitor', async () => {
      server.use(
        http.get(endpoints.listMonitorDowntimes(12345), () => {
          return jsonResponse({
            data: [fixtures.list.data[0]]
          })
        })
      )

      const result = await listMonitorDowntimes(api, 12345, defaultLimits)

      expect(result.downtimes).toHaveLength(1)
      expect(result.downtimes[0].id).toBe('dt-001')
    })
  })
})
