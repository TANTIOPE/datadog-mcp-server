/**
 * Unit tests for the dashboards tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { dashboards as fixtures } from '../helpers/fixtures.js'

describe('Dashboards Tool', () => {
  let api: v1.DashboardsApi

  beforeEach(() => {
    const config = createMockConfig()
    api = new v1.DashboardsApi(config)
  })

  describe('listDashboards', () => {
    it('should list dashboards successfully', async () => {
      server.use(
        http.get(endpoints.listDashboards, () => {
          return jsonResponse(fixtures.list)
        })
      )

      const response = await api.listDashboards({})

      expect(response.dashboards).toHaveLength(2)
      expect(response.dashboards?.[0]?.id).toBe('abc-123')
      expect(response.dashboards?.[0]?.title).toBe('Production Overview')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listDashboards, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(api.listDashboards({})).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.listDashboards, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(api.listDashboards({})).rejects.toMatchObject({
        code: 429
      })
    })
  })

  describe('getDashboard', () => {
    it('should get a single dashboard by ID', async () => {
      server.use(
        http.get(endpoints.getDashboard('abc-123'), () => {
          return jsonResponse(fixtures.single)
        })
      )

      const response = await api.getDashboard({ dashboardId: 'abc-123' })

      expect(response.id).toBe('abc-123')
      expect(response.title).toBe('Production Overview')
      expect(response.widgets).toHaveLength(2)
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getDashboard('not-exist'), () => {
          return errorResponse(404, 'Dashboard not found')
        })
      )

      await expect(api.getDashboard({ dashboardId: 'not-exist' })).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('createDashboard', () => {
    it('should create a new dashboard', async () => {
      const newDashboard = {
        title: 'New Dashboard',
        layoutType: 'ordered' as const,
        widgets: []
      }

      server.use(
        http.post(endpoints.listDashboards, async () => {
          return jsonResponse({
            id: 'new-123',
            title: 'New Dashboard',
            layout_type: 'ordered',
            widgets: [],
            url: '/dashboard/new-123',
            created_at: new Date().toISOString(),
            modified_at: new Date().toISOString()
          })
        })
      )

      const response = await api.createDashboard({ body: newDashboard })

      expect(response.id).toBe('new-123')
      expect(response.title).toBe('New Dashboard')
    })

    it('should validate required fields locally', async () => {
      // SDK validates required fields before sending
      await expect(
        api.createDashboard({
          body: { title: 'Test' } as v1.Dashboard
        })
      ).rejects.toThrow(/layoutType|layout_type/)
    })
  })

  describe('deleteDashboard', () => {
    it('should delete a dashboard', async () => {
      server.use(
        http.delete(endpoints.getDashboard('abc-123'), () => {
          return jsonResponse({ deleted_dashboard_id: 'abc-123' })
        })
      )

      const response = await api.deleteDashboard({ dashboardId: 'abc-123' })

      expect(response.deletedDashboardId).toBe('abc-123')
    })
  })
})
