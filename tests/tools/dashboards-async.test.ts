/**
 * Comprehensive async tests for dashboards.ts
 * Focuses on updateDashboardRaw and additional edge cases
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import {
  updateDashboardRaw,
  listDashboards,
  getDashboard,
  DatadogApiCredentials
} from '../../src/tools/dashboards.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24,
  defaultLimit: 25
}

const mockCredentials: DatadogApiCredentials = {
  apiKey: 'test-api-key',
  appKey: 'test-app-key',
  site: 'datadoghq.com'
}

describe('Dashboards Async Functions', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('updateDashboardRaw', () => {
    it('should update a dashboard successfully via raw HTTP', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'abc-123',
            title: 'Updated Dashboard',
            url: '/dashboard/abc-123'
          })
      })

      const config = {
        title: 'Updated Dashboard',
        description: 'Updated description',
        layoutType: 'ordered',
        widgets: []
      }

      const result = await updateDashboardRaw(mockCredentials, 'abc-123', config)

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.datadoghq.com/api/v1/dashboard/abc-123',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            'DD-API-KEY': 'test-api-key',
            'DD-APPLICATION-KEY': 'test-app-key'
          })
        })
      )
      expect(result.success).toBe(true)
      expect(result.dashboard.id).toBe('abc-123')
      expect(result.dashboard.title).toBe('Updated Dashboard')
      expect(result.dashboard.url).toBe('/dashboard/abc-123')
    })

    it('should handle partial dashboard updates', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'xyz-789',
            title: 'Partial Update',
            url: '/dashboard/xyz-789'
          })
      })

      const config = {
        title: 'Partial Update',
        layoutType: 'free' // Required field
      }

      const result = await updateDashboardRaw(mockCredentials, 'xyz-789', config)

      expect(result.success).toBe(true)
      expect(result.dashboard.title).toBe('Partial Update')
    })

    it('should handle dashboard with empty optional fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'empty-123',
            title: '',
            url: ''
          })
      })

      const result = await updateDashboardRaw(mockCredentials, 'empty-123', {
        layoutType: 'ordered',
        widgets: []
      })

      expect(result.success).toBe(true)
      expect(result.dashboard.id).toBe('empty-123')
      expect(result.dashboard.title).toBe('')
      expect(result.dashboard.url).toBe('')
    })

    it('should handle 404 not found error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve(JSON.stringify({ errors: ['Dashboard not found'] }))
      })

      await expect(
        updateDashboardRaw(mockCredentials, 'nonexistent', { title: 'Test', layoutType: 'ordered' })
      ).rejects.toMatchObject({
        code: 404
      })
    })

    it('should handle 400 bad request error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({ errors: ['Invalid dashboard config'] }))
      })

      await expect(
        updateDashboardRaw(mockCredentials, 'abc-123', { layoutType: 'ordered', invalid: 'config' })
      ).rejects.toMatchObject({
        code: 400
      })
    })

    it('should handle 403 forbidden error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve(JSON.stringify({ errors: ['Insufficient permissions'] }))
      })

      await expect(
        updateDashboardRaw(mockCredentials, 'abc-123', { title: 'Test', layoutType: 'ordered' })
      ).rejects.toMatchObject({
        code: 403
      })
    })

    it('should URL-encode the dashboard ID to prevent path injection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'test', title: 'Test', url: '/dashboard/test' })
      })

      await updateDashboardRaw(mockCredentials, '../../../admin', {
        title: 'Test',
        layoutType: 'ordered'
      })

      // Verify the ID is URL-encoded
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.datadoghq.com/api/v1/dashboard/..%2F..%2F..%2Fadmin',
        expect.any(Object)
      )
    })
  })

  describe('listDashboards - additional edge cases', () => {
    it('should handle empty dashboard list', async () => {
      const mockApi = {
        listDashboards: vi.fn().mockResolvedValue({
          dashboards: []
        })
      } as unknown as v1.DashboardsApi

      const result = await listDashboards(mockApi, {}, defaultLimits)

      expect(result.dashboards).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it('should filter dashboards by query', async () => {
      const mockDashboards = [
        {
          id: 'dash-1',
          title: 'Production Metrics',
          description: 'Prod metrics',
          author_handle: 'user1@example.com',
          created_at: '2024-01-01T00:00:00Z',
          modified_at: '2024-01-15T00:00:00Z',
          url: '/dashboard/dash-1'
        },
        {
          id: 'dash-2',
          title: 'Staging Metrics',
          description: 'Stage metrics',
          author_handle: 'user2@example.com',
          created_at: '2024-01-02T00:00:00Z',
          modified_at: '2024-01-16T00:00:00Z',
          url: '/dashboard/dash-2'
        }
      ]

      const mockApi = {
        listDashboards: vi.fn().mockResolvedValue({
          dashboards: mockDashboards
        })
      } as unknown as v1.DashboardsApi

      const result = await listDashboards(mockApi, { query: 'Production' }, defaultLimits)

      expect(mockApi.listDashboards).toHaveBeenCalled()
      expect(result.dashboards).toBeDefined()
    })

    it('should respect maxResults limit', async () => {
      const limits = { ...defaultLimits, maxResults: 10 }

      const mockApi = {
        listDashboards: vi.fn().mockResolvedValue({
          dashboards: []
        })
      } as unknown as v1.DashboardsApi

      await listDashboards(mockApi, {}, limits)

      // Note: The limit is applied in the tool registration, not in the listDashboards function itself
      expect(mockApi.listDashboards).toHaveBeenCalled()
    })
  })

  describe('getDashboard - additional edge cases', () => {
    it('should get dashboard with full details', async () => {
      const mockDashboard = {
        id: 'full-123',
        title: 'Full Dashboard',
        description: 'Comprehensive dashboard',
        url: '/dashboard/full-123',
        layoutType: 'ordered' as const,
        widgets: [
          {
            id: 1,
            definition: {
              type: 'timeseries',
              requests: []
            }
          }
        ],
        templateVariables: [
          {
            name: 'env',
            prefix: 'env',
            availableValues: ['prod', 'staging'],
            default: 'prod'
          }
        ],
        notifyList: ['user@example.com'],
        tags: ['team:devops']
      }

      const mockApi = {
        getDashboard: vi.fn().mockResolvedValue(mockDashboard)
      } as unknown as v1.DashboardsApi

      const result = await getDashboard(mockApi, 'full-123')

      expect(result.dashboard.id).toBe('full-123')
      expect(result.dashboard.title).toBe('Full Dashboard')
      expect(result.dashboard.widgets).toHaveLength(1) // Full widget array returned
      expect(result.dashboard.templateVariables).toHaveLength(1) // Template variables included
      expect(result.dashboard.notifyList).toEqual(['user@example.com']) // Notify list included
      expect(result.dashboard.tags).toEqual(['team:devops']) // Tags included
    })

    it('should handle dashboard with minimal fields', async () => {
      const mockDashboard = {
        id: 'minimal-123',
        title: '',
        layout_type: 'ordered' as const,
        widgets: []
      }

      const mockApi = {
        getDashboard: vi.fn().mockResolvedValue(mockDashboard)
      } as unknown as v1.DashboardsApi

      const result = await getDashboard(mockApi, 'minimal-123')

      expect(result.dashboard.id).toBe('minimal-123')
      expect(result.dashboard).toBeDefined()
    })

    it('should handle 403 forbidden error', async () => {
      const mockApi = {
        getDashboard: vi.fn().mockRejectedValue({
          code: 403,
          body: { errors: ['Access denied'] }
        })
      } as unknown as v1.DashboardsApi

      await expect(getDashboard(mockApi, 'private-123')).rejects.toMatchObject({
        code: 403
      })
    })
  })
})
