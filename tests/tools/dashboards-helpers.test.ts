/**
 * Tests for dashboards.ts helper functions
 * Focus on normalizeDashboardConfig and listDashboards name filtering
 */
import { describe, it, expect, vi } from 'vitest'
import { v1 } from '@datadog/datadog-api-client'
import {
  normalizeDashboardConfig,
  listDashboards,
  validateDashboardConfig,
  camelToSnake,
  deepConvertCamelToSnake
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
        { name: 'cluster', prefix: 'cluster_name', _default: 'prod' } // default → _default
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

  describe('template variable nested field conversion', () => {
    it('should convert default to _default in templateVariables', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        templateVariables: [
          { name: 'env', prefix: 'env', default: 'prod' },
          { name: 'cluster', prefix: 'cluster_name', default: 'main' }
        ]
      }

      const result = normalizeDashboardConfig(config)
      const tvars = result.templateVariables as Array<Record<string, unknown>>

      expect(tvars[0]._default).toBe('prod')
      expect(tvars[0]).not.toHaveProperty('default')
      expect(tvars[1]._default).toBe('main')
      expect(tvars[1]).not.toHaveProperty('default')
    })

    it('should convert available_values to availableValues in templateVariables', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        templateVariables: [
          { name: 'env', prefix: 'env', available_values: ['prod', 'staging', 'dev'] }
        ]
      }

      const result = normalizeDashboardConfig(config)
      const tvars = result.templateVariables as Array<Record<string, unknown>>

      expect(tvars[0].availableValues).toEqual(['prod', 'staging', 'dev'])
      expect(tvars[0]).not.toHaveProperty('available_values')
    })

    it('should handle template variables with all snake_case fields', () => {
      const config = {
        title: 'Test Dashboard',
        layout_type: 'ordered',
        template_variables: [
          {
            name: 'env',
            prefix: 'env',
            default: 'prod',
            available_values: ['prod', 'staging']
          }
        ]
      }

      const result = normalizeDashboardConfig(config)
      const tvars = result.templateVariables as Array<Record<string, unknown>>

      expect(result).not.toHaveProperty('template_variables')
      expect(result).not.toHaveProperty('layout_type')
      expect(tvars[0]._default).toBe('prod')
      expect(tvars[0].availableValues).toEqual(['prod', 'staging'])
      expect(tvars[0]).not.toHaveProperty('default')
      expect(tvars[0]).not.toHaveProperty('available_values')
    })

    it('should preserve _default if both default and _default are present', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        templateVariables: [{ name: 'env', default: 'old', _default: 'new' }]
      }

      const result = normalizeDashboardConfig(config)
      const tvars = result.templateVariables as Array<Record<string, unknown>>

      expect(tvars[0]._default).toBe('new')
      expect(tvars[0]).not.toHaveProperty('default')
    })

    it('should handle empty templateVariables array', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        templateVariables: []
      }

      const result = normalizeDashboardConfig(config)

      expect(result.templateVariables).toEqual([])
    })

    it('should skip non-object items in templateVariables array', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        templateVariables: [
          { name: 'env', default: 'prod' },
          null,
          'invalid',
          { name: 'cluster', default: 'main' }
        ]
      }

      const result = normalizeDashboardConfig(config)
      const tvars = result.templateVariables as Array<unknown>

      expect((tvars[0] as Record<string, unknown>)._default).toBe('prod')
      expect(tvars[1]).toBeNull()
      expect(tvars[2]).toBe('invalid')
      expect((tvars[3] as Record<string, unknown>)._default).toBe('main')
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

  describe('deep nested snake_case conversion', () => {
    it('should convert widget definition fields deeply', () => {
      const config = {
        title: 'Test Dashboard',
        layout_type: 'ordered',
        widgets: [
          {
            definition: {
              type: 'query_table',
              requests: [
                {
                  response_format: 'scalar',
                  queries: [
                    {
                      data_source: 'metrics',
                      name: 'query1',
                      query: 'avg:system.cpu.user{*}'
                    }
                  ]
                }
              ]
            }
          }
        ]
      }

      const result = normalizeDashboardConfig(config)
      const widgets = result.widgets as Array<Record<string, unknown>>
      const definition = widgets[0].definition as Record<string, unknown>
      const requests = definition.requests as Array<Record<string, unknown>>
      const queries = requests[0].queries as Array<Record<string, unknown>>

      expect(result.layoutType).toBe('ordered')
      expect(definition.type).toBe('query_table') // value unchanged
      expect(requests[0].responseFormat).toBe('scalar')
      expect(queries[0].dataSource).toBe('metrics')
      expect(queries[0].name).toBe('query1')
    })

    it('should convert formulas and display_type in widget requests', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        widgets: [
          {
            definition: {
              type: 'timeseries',
              requests: [
                {
                  display_type: 'line',
                  on_right_yaxis: false,
                  formulas: [{ formula: 'query1', alias: 'CPU Usage' }],
                  queries: [
                    {
                      data_source: 'metrics',
                      name: 'query1',
                      query: 'avg:system.load.1{*}'
                    }
                  ]
                }
              ]
            }
          }
        ]
      }

      const result = normalizeDashboardConfig(config)
      const widgets = result.widgets as Array<Record<string, unknown>>
      const definition = widgets[0].definition as Record<string, unknown>
      const requests = definition.requests as Array<Record<string, unknown>>

      expect(requests[0].displayType).toBe('line')
      expect(requests[0].onRightYaxis).toBe(false)
      expect(requests[0]).not.toHaveProperty('display_type')
      expect(requests[0]).not.toHaveProperty('on_right_yaxis')
    })

    it('should handle deeply nested conditional_formats', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        widgets: [
          {
            definition: {
              type: 'query_value',
              requests: [
                {
                  conditional_formats: [
                    {
                      comparator: '>',
                      value: 90,
                      palette: 'white_on_red',
                      custom_bg_color: '#ff0000'
                    }
                  ],
                  queries: [{ data_source: 'metrics', query: 'avg:cpu{*}', name: 'q1' }]
                }
              ]
            }
          }
        ]
      }

      const result = normalizeDashboardConfig(config)
      const widgets = result.widgets as Array<Record<string, unknown>>
      const definition = widgets[0].definition as Record<string, unknown>
      const requests = definition.requests as Array<Record<string, unknown>>
      const conditionalFormats = requests[0].conditionalFormats as Array<Record<string, unknown>>

      expect(conditionalFormats[0].customBgColor).toBe('#ff0000')
      expect(conditionalFormats[0]).not.toHaveProperty('custom_bg_color')
    })

    it('should preserve string values containing underscores', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        widgets: [
          {
            definition: {
              type: 'timeseries',
              requests: [
                {
                  queries: [
                    {
                      data_source: 'metrics',
                      query: 'avg:system.cpu.user{env:prod_east}', // underscore in value
                      name: 'my_query_name' // underscore in value
                    }
                  ]
                }
              ]
            }
          }
        ]
      }

      const result = normalizeDashboardConfig(config)
      const widgets = result.widgets as Array<Record<string, unknown>>
      const definition = widgets[0].definition as Record<string, unknown>
      const requests = definition.requests as Array<Record<string, unknown>>
      const queries = requests[0].queries as Array<Record<string, unknown>>

      // Values should be unchanged
      expect(queries[0].query).toBe('avg:system.cpu.user{env:prod_east}')
      expect(queries[0].name).toBe('my_query_name')
      // Keys should be converted
      expect(queries[0].dataSource).toBe('metrics')
    })

    it('should handle mixed nesting with template_variables and widgets', () => {
      const config = {
        title: 'Test Dashboard',
        layout_type: 'ordered',
        template_variables: [
          {
            name: 'env',
            prefix: 'environment',
            default: 'production',
            available_values: ['production', 'staging']
          }
        ],
        widgets: [
          {
            definition: {
              type: 'timeseries',
              requests: [
                { queries: [{ data_source: 'metrics', query: 'avg:cpu{$env}', name: 'q1' }] }
              ]
            }
          }
        ]
      }

      const result = normalizeDashboardConfig(config)
      const templateVars = result.templateVariables as Array<Record<string, unknown>>
      const widgets = result.widgets as Array<Record<string, unknown>>
      const definition = widgets[0].definition as Record<string, unknown>
      const requests = definition.requests as Array<Record<string, unknown>>
      const queries = requests[0].queries as Array<Record<string, unknown>>

      // Top-level conversion
      expect(result.layoutType).toBe('ordered')
      expect(result.templateVariables).toBeDefined()
      expect(result).not.toHaveProperty('layout_type')
      expect(result).not.toHaveProperty('template_variables')

      // Template variable nested conversion
      expect(templateVars[0]._default).toBe('production')
      expect(templateVars[0].availableValues).toEqual(['production', 'staging'])

      // Widget nested conversion
      expect(queries[0].dataSource).toBe('metrics')
    })

    it('should handle null and undefined values at various depths', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        description: null,
        widgets: [
          {
            definition: {
              type: 'timeseries',
              custom_field: undefined,
              requests: [{ queries: null }]
            }
          },
          null
        ]
      }

      const result = normalizeDashboardConfig(config)
      const widgets = result.widgets as Array<unknown>
      const firstWidget = widgets[0] as Record<string, unknown>
      const definition = firstWidget.definition as Record<string, unknown>
      const requests = definition.requests as Array<Record<string, unknown>>

      expect(result.description).toBeNull()
      expect(definition.customField).toBeUndefined()
      expect(requests[0].queries).toBeNull()
      expect(widgets[1]).toBeNull()
    })

    it('should handle empty objects and arrays', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        widgets: [],
        template_variables: [],
        metadata: {}
      }

      const result = normalizeDashboardConfig(config)

      expect(result.widgets).toEqual([])
      expect(result.templateVariables).toEqual([])
      expect(result.metadata).toEqual({})
    })

    it('should handle nested arrays of arrays', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        widgets: [
          {
            definition: {
              type: 'group',
              widgets: [
                [
                  { definition: { type: 'note', content: 'test', background_color: 'yellow' } },
                  { definition: { type: 'note', content: 'test2', font_size: '14' } }
                ]
              ]
            }
          }
        ]
      }

      const result = normalizeDashboardConfig(config)
      const widgets = result.widgets as Array<Record<string, unknown>>
      const groupDef = widgets[0].definition as Record<string, unknown>
      const nestedWidgets = groupDef.widgets as Array<Array<Record<string, unknown>>>

      expect(nestedWidgets[0][0].definition).toHaveProperty('backgroundColor', 'yellow')
      expect(nestedWidgets[0][1].definition).toHaveProperty('fontSize', '14')
    })

    it('should convert keys with numbers like query_1', () => {
      const config = {
        title: 'Test Dashboard',
        layoutType: 'ordered',
        widgets: [
          {
            definition: {
              type: 'timeseries',
              requests: [
                {
                  query_1_name: 'first',
                  response_format_2: 'scalar'
                }
              ]
            }
          }
        ]
      }

      const result = normalizeDashboardConfig(config)
      const widgets = result.widgets as Array<Record<string, unknown>>
      const definition = widgets[0].definition as Record<string, unknown>
      const requests = definition.requests as Array<Record<string, unknown>>

      expect(requests[0].query1Name).toBe('first')
      expect(requests[0].responseFormat2).toBe('scalar')
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

  describe('camelToSnake', () => {
    it('should convert camelCase to snake_case', () => {
      expect(camelToSnake('layoutType')).toBe('layout_type')
      expect(camelToSnake('templateVariables')).toBe('template_variables')
      expect(camelToSnake('conditionalFormats')).toBe('conditional_formats')
    })

    it('should convert _default to default (Datadog API expects default without prefix)', () => {
      expect(camelToSnake('_default')).toBe('default')
    })

    it('should handle already lowercase strings', () => {
      expect(camelToSnake('name')).toBe('name')
      expect(camelToSnake('query')).toBe('query')
      expect(camelToSnake('type')).toBe('type')
    })

    it('should handle strings with numbers', () => {
      // Note: This is intentionally asymmetric with snakeToCamel
      // snakeToCamel: query_1 → query1
      // camelToSnake: query1 → query1 (NOT query_1)
      // This is fine because Datadog API accepts both forms
      expect(camelToSnake('query1')).toBe('query1')
      expect(camelToSnake('query1Name')).toBe('query1_name')
    })

    it('should handle consecutive uppercase letters', () => {
      // Edge case: consecutive uppercase becomes multiple underscores
      // This doesn't occur in Datadog's actual API field names
      expect(camelToSnake('HTTPRequest')).toBe('_h_t_t_p_request')
    })

    it('should handle single character strings', () => {
      expect(camelToSnake('a')).toBe('a')
      expect(camelToSnake('A')).toBe('_a')
    })

    it('should handle empty string', () => {
      expect(camelToSnake('')).toBe('')
    })
  })

  describe('deepConvertCamelToSnake', () => {
    it('should convert all keys in nested objects', () => {
      const input = {
        layoutType: 'ordered',
        templateVariables: [{ name: 'env', _default: 'prod' }],
        notifyList: ['user@example.com']
      }

      const result = deepConvertCamelToSnake(input) as Record<string, unknown>

      expect(result.layout_type).toBe('ordered')
      expect(result.template_variables).toBeDefined()
      expect(result.notify_list).toEqual(['user@example.com'])
      expect(result).not.toHaveProperty('layoutType')
      expect(result).not.toHaveProperty('templateVariables')
      expect(result).not.toHaveProperty('notifyList')
    })

    it('should convert _default to default in nested objects', () => {
      const input = {
        templateVariables: [{ name: 'env', _default: 'prod', availableValues: ['prod', 'dev'] }]
      }

      const result = deepConvertCamelToSnake(input) as Record<string, unknown>
      const vars = result.template_variables as Array<Record<string, unknown>>

      expect(vars[0].default).toBe('prod')
      expect(vars[0].available_values).toEqual(['prod', 'dev'])
      expect(vars[0]).not.toHaveProperty('_default')
      expect(vars[0]).not.toHaveProperty('availableValues')
    })

    it('should handle arrays of primitives', () => {
      const input = {
        tags: ['team:ops', 'env:prod']
      }

      const result = deepConvertCamelToSnake(input) as Record<string, unknown>

      expect(result.tags).toEqual(['team:ops', 'env:prod'])
    })

    it('should preserve null and undefined values', () => {
      const input = {
        layoutType: 'ordered',
        description: null,
        customField: undefined
      }

      const result = deepConvertCamelToSnake(input) as Record<string, unknown>

      expect(result.layout_type).toBe('ordered')
      expect(result.description).toBeNull()
      expect(result.custom_field).toBeUndefined()
    })

    it('should handle deeply nested widget definitions', () => {
      const input = {
        widgets: [
          {
            definition: {
              type: 'timeseries',
              requests: [
                {
                  displayType: 'line',
                  conditionalFormats: [{ comparator: '>', customBgColor: '#ff0000' }],
                  queries: [{ dataSource: 'metrics', name: 'query1' }]
                }
              ]
            }
          }
        ]
      }

      const result = deepConvertCamelToSnake(input) as Record<string, unknown>
      const widgets = result.widgets as Array<Record<string, unknown>>
      const definition = widgets[0].definition as Record<string, unknown>
      const requests = definition.requests as Array<Record<string, unknown>>
      const conditionalFormats = requests[0].conditional_formats as Array<Record<string, unknown>>
      const queries = requests[0].queries as Array<Record<string, unknown>>

      expect(requests[0].display_type).toBe('line')
      expect(conditionalFormats[0].custom_bg_color).toBe('#ff0000')
      expect(queries[0].data_source).toBe('metrics')
    })

    it('should handle empty objects and arrays', () => {
      expect(deepConvertCamelToSnake({})).toEqual({})
      expect(deepConvertCamelToSnake([])).toEqual([])
    })

    it('should return primitives unchanged', () => {
      expect(deepConvertCamelToSnake('string')).toBe('string')
      expect(deepConvertCamelToSnake(123)).toBe(123)
      expect(deepConvertCamelToSnake(true)).toBe(true)
      expect(deepConvertCamelToSnake(null)).toBeNull()
    })

    it('should handle max nesting depth protection', () => {
      // Create deeply nested object (beyond MAX_NESTING_DEPTH of 20)
      let obj: Record<string, unknown> = { deepKey: 'value' }
      for (let i = 0; i < 25; i++) {
        obj = { nestedLevel: obj }
      }

      // Should not throw, returns obj at max depth
      const result = deepConvertCamelToSnake(obj)
      expect(result).toBeDefined()
    })
  })

  describe('round-trip conversion (normalize → camelToSnake)', () => {
    it('should produce valid snake_case for Datadog API', () => {
      // Input in snake_case (as user might provide)
      const input = {
        title: 'Test Dashboard',
        layout_type: 'ordered',
        template_variables: [{ name: 'env', default: 'prod' }],
        widgets: [
          {
            definition: {
              type: 'timeseries',
              requests: [{ display_type: 'line', data_source: 'metrics' }]
            }
          }
        ]
      }

      // Step 1: Normalize (snake → camel)
      const normalized = normalizeDashboardConfig(input)

      // Step 2: Convert back to snake_case for API
      const forApi = deepConvertCamelToSnake(normalized) as Record<string, unknown>

      // Verify output is valid snake_case
      expect(forApi.layout_type).toBe('ordered')
      expect(forApi.template_variables).toBeDefined()
      const vars = forApi.template_variables as Array<Record<string, unknown>>
      expect(vars[0].default).toBe('prod') // _default → default
      expect(vars[0]).not.toHaveProperty('_default')
    })
  })
})
