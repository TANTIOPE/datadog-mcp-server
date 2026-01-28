/**
 * Unit tests for the dashboards tool
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { http } from 'msw'
import { server, endpoints, jsonResponse, errorResponse } from '../helpers/msw.js'
import { createMockConfig } from '../helpers/mock.js'
import { dashboards as fixtures } from '../helpers/fixtures.js'
import {
  listDashboards,
  getDashboard,
  createDashboardRaw,
  deleteDashboard,
  DatadogApiCredentials
} from '../../src/tools/dashboards.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24
}

const mockCredentials: DatadogApiCredentials = {
  apiKey: 'test-api-key',
  appKey: 'test-app-key',
  site: 'datadoghq.com'
}

describe('Dashboards Tool', () => {
  let api: v1.DashboardsApi
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const config = createMockConfig()
    api = new v1.DashboardsApi(config)

    // Mock fetch for raw HTTP calls
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
      expect(result.dashboard.widgets).toHaveLength(2) // Now returns full widget array
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

  describe('createDashboardRaw', () => {
    it('should create a new dashboard via raw HTTP', async () => {
      const newDashboard = {
        title: 'New Dashboard',
        layoutType: 'ordered',
        widgets: []
      }

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'new-123',
            title: 'New Dashboard',
            url: '/dashboard/new-123'
          })
      })

      const result = await createDashboardRaw(mockCredentials, newDashboard)

      expect(result.success).toBe(true)
      expect(result.dashboard.id).toBe('new-123')
      expect(result.dashboard.title).toBe('New Dashboard')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.datadoghq.com/api/v1/dashboard',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'DD-API-KEY': 'test-api-key',
            'DD-APPLICATION-KEY': 'test-app-key'
          })
        })
      )
    })

    it('should validate required fields', async () => {
      await expect(createDashboardRaw(mockCredentials, { title: 'Test' })).rejects.toThrow(
        /layoutType/
      )
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
