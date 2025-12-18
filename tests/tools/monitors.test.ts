/**
 * Unit tests for the monitors tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { monitors as fixtures } from '../helpers/fixtures.js'
import {
  listMonitors,
  getMonitor,
  searchMonitors,
  createMonitor,
  updateMonitor,
  deleteMonitor
} from '../../src/tools/monitors.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

const defaultSite = 'datadoghq.com'

describe('Monitors Tool', () => {
  let api: v1.MonitorsApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v1.MonitorsApi(config)
  })

  describe('listMonitors', () => {
    it('should list monitors successfully', async () => {
      server.use(
        http.get(endpoints.listMonitors, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listMonitors(api, {}, defaultLimits, defaultSite)

      expect(result.monitors).toHaveLength(2)
      expect(result.monitors[0].id).toBe(12345)
      expect(result.monitors[0].name).toBe('High CPU Usage')
      expect(result.monitors[0].status).toBe('Alert')
      expect(result.summary.total).toBe(2)
    })

    it('should filter monitors by name', async () => {
      server.use(
        http.get(endpoints.listMonitors, ({ request }) => {
          const url = new URL(request.url)
          const name = url.searchParams.get('name')

          if (name === 'CPU') {
            return jsonResponse([fixtures.list[0]])
          }
          return jsonResponse(fixtures.list)
        })
      )

      const result = await listMonitors(api, { name: 'CPU' }, defaultLimits, defaultSite)

      expect(result.monitors).toHaveLength(1)
      expect(result.monitors[0].name).toContain('CPU')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listMonitors, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listMonitors(api, {}, defaultLimits, defaultSite)).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listMonitors, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(listMonitors(api, {}, defaultLimits, defaultSite)).rejects.toMatchObject({
        code: 403
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.listMonitors, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(listMonitors(api, {}, defaultLimits, defaultSite)).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('getMonitor', () => {
    it('should get a single monitor by ID', async () => {
      server.use(
        http.get(endpoints.getMonitor(12345), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const result = await getMonitor(api, '12345', defaultSite)

      expect(result.monitor.id).toBe(12345)
      expect(result.monitor.name).toBe('High CPU Usage')
      expect(result.monitor.query).toContain('system.cpu.user')
      expect(result.datadog_url).toContain('datadoghq.com')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getMonitor(99999), () => {
          return errorResponse(404, 'Monitor not found')
        })
      )

      await expect(getMonitor(api, '99999', defaultSite)).rejects.toMatchObject({
        code: 404
      })
    })

    it('should handle invalid monitor ID', async () => {
      await expect(getMonitor(api, 'invalid', defaultSite)).rejects.toThrow('Invalid monitor ID')
    })
  })

  describe('searchMonitors', () => {
    it('should search monitors by query', async () => {
      server.use(
        http.get(endpoints.searchMonitors, ({ request }) => {
          const url = new URL(request.url)
          const query = url.searchParams.get('query')

          expect(query).toBe('cpu')
          return jsonResponse(fixtures.searchResults)
        })
      )

      const result = await searchMonitors(api, 'cpu', defaultLimits, defaultSite)

      expect(result.monitors).toHaveLength(1)
      expect(result.monitors[0].id).toBe(12345)
      expect(result.metadata.totalCount).toBeDefined()
    })
  })

  describe('createMonitor', () => {
    it('should create a new monitor', async () => {
      const newMonitor = {
        name: 'New Test Monitor',
        type: 'metric alert',
        query: 'avg(last_5m):avg:system.cpu.user{*} > 95',
        message: 'CPU is very high'
      }

      server.use(
        http.post(endpoints.listMonitors, async ({ request }) => {
          const body = (await request.json()) as typeof newMonitor
          return jsonResponse({
            id: 12347,
            ...body,
            overall_state: 'No Data',
            created: new Date().toISOString(),
            modified: new Date().toISOString()
          })
        })
      )

      const result = await createMonitor(api, newMonitor)

      expect(result.success).toBe(true)
      expect(result.monitor.id).toBe(12347)
      expect(result.monitor.name).toBe('New Test Monitor')
    })

    it('should validate required fields', async () => {
      await expect(createMonitor(api, {})).rejects.toThrow(
        /requires at least/
      )
    })

    it('should handle 400 bad request from API', async () => {
      server.use(
        http.post(endpoints.listMonitors, () => {
          return errorResponse(400, 'Invalid query syntax')
        })
      )

      const validConfig = {
        name: 'Test Monitor',
        type: 'metric alert',
        query: 'invalid query that API rejects'
      }

      await expect(createMonitor(api, validConfig)).rejects.toMatchObject({
        code: 400
      })
    })
  })

  describe('updateMonitor', () => {
    it('should update an existing monitor', async () => {
      server.use(
        http.put(endpoints.getMonitor(12345), async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>
          return jsonResponse({
            ...fixtures.single,
            ...body
          })
        })
      )

      const result = await updateMonitor(api, '12345', {
        name: 'Updated Monitor Name',
        type: 'metric alert',
        query: 'test'
      })

      expect(result.success).toBe(true)
      expect(result.monitor.name).toBe('Updated Monitor Name')
    })
  })

  describe('deleteMonitor', () => {
    it('should delete a monitor', async () => {
      server.use(
        http.delete(endpoints.getMonitor(12345), () => {
          return jsonResponse({ deleted_monitor_id: 12345 })
        })
      )

      const result = await deleteMonitor(api, '12345')

      expect(result.success).toBe(true)
      expect(result.message).toContain('12345')
    })
  })
})
