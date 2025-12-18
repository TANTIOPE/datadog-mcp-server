/**
 * Unit tests for the dashboards tool
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { dashboards as fixtures } from '../helpers/fixtures.js'
import {
  listDashboards,
  getDashboard,
  createDashboard,
  deleteDashboard
} from '../../src/tools/dashboards.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

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

      const result = await listDashboards(api, {}, defaultLimits)

      expect(result.dashboards).toHaveLength(2)
      expect(result.dashboards[0].id).toBe('abc-123')
      expect(result.dashboards[0].title).toBe('Production Overview')
    })

    it('should handle 401 unauthorized error', async () => {
      server.use(
        http.get(endpoints.listDashboards, () => {
          return errorResponse(401, 'Invalid API key')
        })
      )

      await expect(listDashboards(api, {}, defaultLimits)).rejects.toMatchObject({
        code: 401
      })
    })

    it('should handle 429 rate limit error', async () => {
      server.use(
        http.get(endpoints.listDashboards, () => {
          return errorResponse(429, 'Rate limit exceeded')
        })
      )

      await expect(listDashboards(api, {}, defaultLimits)).rejects.toMatchObject({
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

      const result = await getDashboard(api, 'abc-123')

      expect(result.dashboard.id).toBe('abc-123')
      expect(result.dashboard.title).toBe('Production Overview')
      expect(result.dashboard.widgets).toBe(2)
    })

    it('should handle 404 not found error', async () => {
      server.use(
        http.get(endpoints.getDashboard('not-exist'), () => {
          return errorResponse(404, 'Dashboard not found')
        })
      )

      await expect(getDashboard(api, 'not-exist')).rejects.toMatchObject({
        code: 404
      })
    })
  })

  describe('createDashboard', () => {
    it('should create a new dashboard', async () => {
      const newDashboard = {
        title: 'New Dashboard',
        layoutType: 'ordered',
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

      const result = await createDashboard(api, newDashboard)

      expect(result.success).toBe(true)
      expect(result.dashboard.id).toBe('new-123')
      expect(result.dashboard.title).toBe('New Dashboard')
    })

    it('should validate required fields', async () => {
      await expect(createDashboard(api, { title: 'Test' })).rejects.toThrow(/layoutType/)
    })
  })

  describe('deleteDashboard', () => {
    it('should delete a dashboard', async () => {
      server.use(
        http.delete(endpoints.getDashboard('abc-123'), () => {
          return jsonResponse({ deleted_dashboard_id: 'abc-123' })
        })
      )

      const result = await deleteDashboard(api, 'abc-123')

      expect(result.success).toBe(true)
      expect(result.message).toContain('abc-123')
    })
  })
})
