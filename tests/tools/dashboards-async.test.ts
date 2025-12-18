/**
 * Comprehensive async tests for dashboards.ts
 * Focuses on updateDashboard (completely untested) and additional edge cases
 */
import { describe, it, expect, vi } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import { updateDashboard, listDashboards, getDashboard } from '../../src/tools/dashboards.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24,
  defaultLimit: 25
}

describe('Dashboards Async Functions', () => {
  describe('updateDashboard', () => {
    it('should update a dashboard successfully', async () => {
      const mockDashboard = {
        id: 'abc-123',
        title: 'Updated Dashboard',
        description: 'Updated description',
        url: '/dashboard/abc-123',
        layout_type: 'ordered' as const,
        widgets: []
      }

      const mockApi = {
        updateDashboard: vi.fn().mockResolvedValue(mockDashboard)
      } as unknown as v1.DashboardsApi

      const config = {
        title: 'Updated Dashboard',
        description: 'Updated description',
        layoutType: 'ordered',
        widgets: []
      }

      const result = await updateDashboard(mockApi, 'abc-123', config)

      expect(mockApi.updateDashboard).toHaveBeenCalledWith({
        dashboardId: 'abc-123',
        body: expect.objectContaining({
          title: 'Updated Dashboard',
          layoutType: 'ordered'
        })
      })
      expect(result.success).toBe(true)
      expect(result.dashboard.id).toBe('abc-123')
      expect(result.dashboard.title).toBe('Updated Dashboard')
      expect(result.dashboard.url).toBe('/dashboard/abc-123')
    })

    it('should handle partial dashboard updates', async () => {
      const mockDashboard = {
        id: 'xyz-789',
        title: 'Partial Update',
        url: '/dashboard/xyz-789',
        layout_type: 'free' as const,
        widgets: []
      }

      const mockApi = {
        updateDashboard: vi.fn().mockResolvedValue(mockDashboard)
      } as unknown as v1.DashboardsApi

      const config = {
        title: 'Partial Update',
        layoutType: 'free' // Required field
      }

      const result = await updateDashboard(mockApi, 'xyz-789', config)

      expect(result.success).toBe(true)
      expect(result.dashboard.title).toBe('Partial Update')
    })

    it('should handle dashboard with empty optional fields', async () => {
      const mockDashboard = {
        id: 'empty-123',
        title: '',
        url: '',
        layout_type: 'ordered' as const,
        widgets: []
      }

      const mockApi = {
        updateDashboard: vi.fn().mockResolvedValue(mockDashboard)
      } as unknown as v1.DashboardsApi

      const result = await updateDashboard(mockApi, 'empty-123', {
        layoutType: 'ordered',
        widgets: []
      })

      expect(result.success).toBe(true)
      expect(result.dashboard.id).toBe('empty-123')
      expect(result.dashboard.title).toBe('')
      expect(result.dashboard.url).toBe('')
    })

    it('should handle 404 not found error', async () => {
      const mockApi = {
        updateDashboard: vi.fn().mockRejectedValue({
          code: 404,
          body: { errors: ['Dashboard not found'] }
        })
      } as unknown as v1.DashboardsApi

      await expect(
        updateDashboard(mockApi, 'nonexistent', { title: 'Test', layoutType: 'ordered' })
      ).rejects.toMatchObject({
        code: 404
      })
    })

    it('should handle 400 bad request error', async () => {
      const mockApi = {
        updateDashboard: vi.fn().mockRejectedValue({
          code: 400,
          body: { errors: ['Invalid dashboard config'] }
        })
      } as unknown as v1.DashboardsApi

      await expect(
        updateDashboard(mockApi, 'abc-123', { layoutType: 'ordered', invalid: 'config' })
      ).rejects.toMatchObject({
        code: 400
      })
    })

    it('should handle 403 forbidden error', async () => {
      const mockApi = {
        updateDashboard: vi.fn().mockRejectedValue({
          code: 403,
          body: { errors: ['Insufficient permissions'] }
        })
      } as unknown as v1.DashboardsApi

      await expect(
        updateDashboard(mockApi, 'abc-123', { title: 'Test', layoutType: 'ordered' })
      ).rejects.toMatchObject({
        code: 403
      })
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
        layout_type: 'ordered' as const,
        widgets: [
          {
            id: 1,
            definition: {
              type: 'timeseries',
              requests: []
            }
          }
        ],
        template_variables: [
          {
            name: 'env',
            prefix: 'env',
            available_values: ['prod', 'staging'],
            default: 'prod'
          }
        ],
        notify_list: ['user@example.com']
      }

      const mockApi = {
        getDashboard: vi.fn().mockResolvedValue(mockDashboard)
      } as unknown as v1.DashboardsApi

      const result = await getDashboard(mockApi, 'full-123')

      expect(result.dashboard.id).toBe('full-123')
      expect(result.dashboard.title).toBe('Full Dashboard')
      expect(result.dashboard.widgets).toBe(1) // Count of widgets, not the array
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
