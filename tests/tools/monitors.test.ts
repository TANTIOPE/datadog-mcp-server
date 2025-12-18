/**
 * Unit tests for the monitors tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { monitors as fixtures } from '../helpers/fixtures.js'

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

      const response = await api.listMonitors({})

      expect(response).toHaveLength(2)
      expect(response[0].id).toBe(12345)
      expect(response[0].name).toBe('High CPU Usage')
      expect(response[0].overallState).toBe('Alert')
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

      const response = await api.listMonitors({ name: 'CPU' })

      expect(response).toHaveLength(1)
      expect(response[0].name).toContain('CPU')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listMonitors, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(api.listMonitors({})).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 403 forbidden error', async () => {
      server.use(
        http.get(endpoints.listMonitors, () => {
          return errorResponse(403, 'Insufficient permissions')
        })
      )

      await expect(api.listMonitors({})).rejects.toMatchObject({
        code: 403
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.listMonitors, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(api.listMonitors({})).rejects.toMatchObject({
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

      const response = await api.getMonitor({ monitorId: 12345 })

      expect(response.id).toBe(12345)
      expect(response.name).toBe('High CPU Usage')
      expect(response.query).toContain('system.cpu.user')
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getMonitor(99999), () => {
          return errorResponse(404, 'Monitor not found')
        })
      )

      await expect(api.getMonitor({ monitorId: 99999 })).rejects.toMatchObject({
        code: 404
      })
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

      const response = await api.searchMonitors({ query: 'cpu' })

      expect(response.monitors).toHaveLength(1)
      // Note: metadata might not be present in all SDK versions
      expect(response.monitors?.[0]?.id).toBe(12345)
    })
  })

  describe('createMonitor', () => {
    it('should create a new monitor', async () => {
      const newMonitor = {
        name: 'New Test Monitor',
        type: 'metric alert' as const,
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

      const response = await api.createMonitor({ body: newMonitor })

      expect(response.id).toBe(12347)
      expect(response.name).toBe('New Test Monitor')
    })

    it('should validate required fields locally', async () => {
      // The Datadog SDK validates required fields (like 'query') before sending
      // This test verifies that local validation works
      await expect(api.createMonitor({ body: {} as v1.Monitor })).rejects.toThrow(
        /missing required property/
      )
    })

    it('should handle 400 bad request from API', async () => {
      // For API-level 400 errors (e.g., invalid query syntax)
      server.use(
        http.post(endpoints.listMonitors, () => {
          return errorResponse(400, 'Invalid query syntax')
        })
      )

      const validBody = {
        name: 'Test Monitor',
        type: 'metric alert' as const,
        query: 'invalid query that API rejects'
      }

      await expect(api.createMonitor({ body: validBody })).rejects.toMatchObject({
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

      const response = await api.updateMonitor({
        monitorId: 12345,
        body: { name: 'Updated Monitor Name' }
      })

      expect(response.name).toBe('Updated Monitor Name')
    })
  })

  describe('deleteMonitor', () => {
    it('should delete a monitor', async () => {
      server.use(
        http.delete(endpoints.getMonitor(12345), () => {
          return jsonResponse({ deleted_monitor_id: 12345 })
        })
      )

      const response = await api.deleteMonitor({ monitorId: 12345 })

      expect(response.deletedMonitorId).toBe(12345)
    })
  })
})
