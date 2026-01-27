/**
 * Tests for dashboards.ts helper functions
 * Focus on normalizeDashboardConfig and listDashboards name filtering
 */
import { describe, it, expect, vi } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import {
  normalizeDashboardConfig,
  listDashboards,
  validateDashboardConfig
} from '../../src/tools/dashboards.js'
import type { LimitsConfig } from '../../src/config/schema.js'

const defaultLimits: LimitsConfig = {
  maxResults: 100,
  maxLogLines: 500,
  maxMetricDataPoints: 1000,
  defaultTimeRangeHours: 24,
  defaultLimit: 25
}

describe('Dashboards Helper Functions', () => {
  describe('normalizeDashboardConfig', () => {
    it('should convert layout_type to layoutType', () => {
      const config = {
        title: 'Test Dashboard',
        layout_type: 'ordered'
      }

      const result = normalizeDashboardConfig(config)

      expect(result.layoutType).toBe('ordered')
      expect(result).not.toHaveProperty('layout_type')
    })

    it('should use layoutType and remove layout_type if both are present', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'free',
        layout_type: 'ordered' // Should be removed
      }

      const result = normalizeDashboardConfig(config)

      expect(result.layoutType).toBe('free')
      expect(result).not.toHaveProperty('layout_type')
    })

    it('should throw error if layoutType is missing', () => {
      const config = {
        title: 'Test Dashboard'
      }

      expect(() => normalizeDashboardConfig(config)).toThrow(
        "Dashboard config requires 'layoutType'"
      )
    })

    it('should accept config with layoutType already set', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered'
      }

      const result = normalizeDashboardConfig(config)

      expect(result.layoutType).toBe('ordered')
    })

    it('should preserve other fields', () => {
      const config = {
        title: 'Test Dashboard',
        description: 'Test description',
        layout_type: 'free',
        widgets: [],
        templateVariables: []
      }

      const result = normalizeDashboardConfig(config)

      expect(result.title).toBe('Test Dashboard')
      expect(result.description).toBe('Test description')
      expect(result.widgets).toEqual([])
      expect(result.templateVariables).toEqual([])
    })

    it('should not mutate original config', () => {
      const config = {
        title: 'Test Dashboard',
        layout_type: 'ordered'
      }

      const originalCopy = JSON.parse(JSON.stringify(config))
      normalizeDashboardConfig(config)

      expect(config).toEqual(originalCopy)
    })

    it('should convert template_variables to templateVariables', () => {
      const config = {
        title: 'Test Dashboard',
        layout_type: 'ordered',
        template_variables: [{ name: 'cluster', prefix: 'cluster_name', default: 'prod' }]
      }

      const result = normalizeDashboardConfig(config)

      expect(result.templateVariables).toEqual([
        { name: 'cluster', prefix: 'cluster_name', default: 'prod' }
      ])
      expect(result).not.toHaveProperty('template_variables')
    })

    it('should convert notify_list to notifyList', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        notify_list: ['user@example.com']
      }

      const result = normalizeDashboardConfig(config)

      expect(result.notifyList).toEqual(['user@example.com'])
      expect(result).not.toHaveProperty('notify_list')
    })

    it('should convert multiple snake_case fields at once', () => {
      const config = {
        title: 'Test Dashboard',
        layout_type: 'ordered',
        template_variables: [{ name: 'env' }],
        notify_list: ['user@example.com'],
        reflow_type: 'auto'
      }

      const result = normalizeDashboardConfig(config)

      expect(result.layoutType).toBe('ordered')
      expect(result.templateVariables).toEqual([{ name: 'env' }])
      expect(result.notifyList).toEqual(['user@example.com'])
      expect(result.reflowType).toBe('auto')
      expect(result).not.toHaveProperty('layout_type')
      expect(result).not.toHaveProperty('template_variables')
      expect(result).not.toHaveProperty('notify_list')
      expect(result).not.toHaveProperty('reflow_type')
    })

    it('should use camelCase and remove snake_case if both are present', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        template_variables: [{ name: 'old' }],
        templateVariables: [{ name: 'new' }]
      }

      const result = normalizeDashboardConfig(config)

      // camelCase takes precedence, snake_case is always removed
      expect(result.templateVariables).toEqual([{ name: 'new' }])
      expect(result).not.toHaveProperty('template_variables')
    })
  })

  describe('listDashboards with name filtering', () => {
    it('should filter dashboards by name (case-insensitive)', async () => {
      const mockDashboards = [
        {
          id: 'dash-1',
          title: 'Production Metrics',
          author_handle: 'user1@example.com',
          url: '/dashboard/dash-1',
          created: '2024-01-01T00:00:00Z',
          modified: '2024-01-15T00:00:00Z'
        },
        {
          id: 'dash-2',
          title: 'Staging Metrics',
          author_handle: 'user2@example.com',
          url: '/dashboard/dash-2',
          created: '2024-01-02T00:00:00Z',
          modified: '2024-01-16T00:00:00Z'
        },
        {
          id: 'dash-3',
          title: 'Development Logs',
          author_handle: 'user3@example.com',
          url: '/dashboard/dash-3',
          created: '2024-01-03T00:00:00Z',
          modified: '2024-01-17T00:00:00Z'
        }
      ]

      const mockApi = {
        listDashboards: vi.fn().mockResolvedValue({
          dashboards: mockDashboards
        })
      } as unknown as v1.DashboardsApi

      const result = await listDashboards(mockApi, { name: 'metrics' }, defaultLimits)

      expect(result.dashboards).toHaveLength(2)
      expect(result.dashboards[0]?.title).toBe('Production Metrics')
      expect(result.dashboards[1]?.title).toBe('Staging Metrics')
      expect(result.total).toBe(3) // Total is still all dashboards from API
    })

    it('should handle name filter with mixed case', async () => {
      const mockDashboards = [
        {
          id: 'dash-1',
          title: 'Production Metrics',
          author_handle: 'user@example.com',
          url: '/dashboard/dash-1',
          created: '2024-01-01T00:00:00Z',
          modified: '2024-01-15T00:00:00Z'
        },
        {
          id: 'dash-2',
          title: 'production logs',
          author_handle: 'user@example.com',
          url: '/dashboard/dash-2',
          created: '2024-01-02T00:00:00Z',
          modified: '2024-01-16T00:00:00Z'
        }
      ]

      const mockApi = {
        listDashboards: vi.fn().mockResolvedValue({
          dashboards: mockDashboards
        })
      } as unknown as v1.DashboardsApi

      const result = await listDashboards(mockApi, { name: 'PRODUCTION' }, defaultLimits)

      // Should match both (case-insensitive)
      expect(result.dashboards).toHaveLength(2)
    })

    it('should return empty array if no dashboards match name', async () => {
      const mockDashboards = [
        {
          id: 'dash-1',
          title: 'Production Metrics',
          author_handle: 'user@example.com',
          url: '/dashboard/dash-1',
          created: '2024-01-01T00:00:00Z',
          modified: '2024-01-15T00:00:00Z'
        }
      ]

      const mockApi = {
        listDashboards: vi.fn().mockResolvedValue({
          dashboards: mockDashboards
        })
      } as unknown as v1.DashboardsApi

      const result = await listDashboards(mockApi, { name: 'nonexistent' }, defaultLimits)

      expect(result.dashboards).toHaveLength(0)
      expect(result.total).toBe(1) // Total is still all dashboards from API
    })

    it('should handle partial name matches', async () => {
      const mockDashboards = [
        {
          id: 'dash-1',
          title: 'API Performance Dashboard',
          author_handle: 'user@example.com',
          url: '/dashboard/dash-1',
          created: '2024-01-01T00:00:00Z',
          modified: '2024-01-15T00:00:00Z'
        }
      ]

      const mockApi = {
        listDashboards: vi.fn().mockResolvedValue({
          dashboards: mockDashboards
        })
      } as unknown as v1.DashboardsApi

      const result = await listDashboards(mockApi, { name: 'Performance' }, defaultLimits)

      expect(result.dashboards).toHaveLength(1)
      expect(result.dashboards[0]?.title).toBe('API Performance Dashboard')
    })
  })

  describe('tag validation', () => {
    it('should accept tags with any key:value format', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        tags: ['team:ops', 'env:prod', 'service:api']
      }

      const result = normalizeDashboardConfig(config)

      expect(result.tags).toEqual(['team:ops', 'env:prod', 'service:api'])
    })

    it('should reject tags without colon separator', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        tags: ['team:ops', 'invalid-tag', 'env:prod']
      }

      expect(() => normalizeDashboardConfig(config)).toThrow(
        'Dashboard tags must use key:value format'
      )
    })

    it('should accept empty tags array', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        tags: []
      }

      const result = normalizeDashboardConfig(config)

      expect(result.tags).toEqual([])
    })

    it('should allow config without tags', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered'
      }

      const result = normalizeDashboardConfig(config)

      expect(result.tags).toBeUndefined()
    })
  })

  describe('validateDashboardConfig', () => {
    it('should return valid for correct config', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        widgets: [{ id: 1, definition: { type: 'timeseries' } }],
        templateVariables: [{ name: 'env', prefix: 'env' }],
        tags: ['team:devops']
      }

      const result = validateDashboardConfig(config)

      expect(result.valid).toBe(true)
      expect(result.normalized.title).toBe('Test Dashboard')
      expect(result.normalized.layoutType).toBe('ordered')
      expect(result.normalized.widgetCount).toBe(1)
      expect(result.normalized.templateVariableCount).toBe(1)
      expect(result.message).toBe('Dashboard configuration is valid')
    })

    it('should return invalid for missing layoutType', () => {
      const config = {
        title: 'Test Dashboard'
      }

      const result = validateDashboardConfig(config)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('layoutType')
      expect(result.hint).toBeDefined()
    })

    it('should return invalid for bad tags', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        tags: ['invalid']
      }

      const result = validateDashboardConfig(config)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('key:value format')
    })

    it('should handle config with layout_type (snake_case)', () => {
      const config = {
        title: 'Test Dashboard',
        layout_type: 'ordered'
      }

      const result = validateDashboardConfig(config)

      expect(result.valid).toBe(true)
      expect(result.normalized.layoutType).toBe('ordered')
    })
  })
})
