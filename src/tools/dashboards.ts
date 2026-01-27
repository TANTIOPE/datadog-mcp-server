import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['list', 'get', 'create', 'update', 'delete', 'validate'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z.string().optional().describe('Dashboard ID (required for get/update/delete)'),
  name: z.string().optional().describe('Filter by name'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  limit: z
    .number()
    .min(1)
    .optional()
    .describe('Maximum number of dashboards to return (default: 50)'),
  config: z.record(z.unknown()).optional().describe('Dashboard configuration (for create/update)')
}

interface DashboardSummary {
  id: string
  title: string
  description: string
  url: string
  layoutType: string
  created: string
  modified: string
  authorHandle: string
}

export function formatDashboardSummary(d: v1.DashboardSummaryDefinition): DashboardSummary {
  return {
    id: d.id ?? '',
    title: d.title ?? '',
    description: d.description ?? '',
    url: d.url ?? '',
    layoutType: String(d.layoutType ?? 'unknown'),
    created: d.createdAt ? new Date(d.createdAt).toISOString() : '',
    modified: d.modifiedAt ? new Date(d.modifiedAt).toISOString() : '',
    authorHandle: d.authorHandle ?? ''
  }
}

export async function listDashboards(
  api: v1.DashboardsApi,
  params: { name?: string; tags?: string[]; limit?: number },
  limits: LimitsConfig
) {
  const effectiveLimit = params.limit ?? limits.defaultLimit

  const response = await api.listDashboards({
    filterShared: false
  })

  let dashboards = response.dashboards ?? []

  // Client-side filtering by name
  if (params.name) {
    const lowerName = params.name.toLowerCase()
    dashboards = dashboards.filter((d) => d.title?.toLowerCase().includes(lowerName))
  }

  const result = dashboards.slice(0, effectiveLimit).map(formatDashboardSummary)

  return {
    dashboards: result,
    total: response.dashboards?.length ?? 0
  }
}

export async function getDashboard(api: v1.DashboardsApi, id: string) {
  const dashboard = await api.getDashboard({ dashboardId: id })
  return {
    dashboard: {
      id: dashboard.id ?? '',
      title: dashboard.title ?? '',
      description: dashboard.description ?? '',
      layoutType: String(dashboard.layoutType ?? 'unknown'),
      url: dashboard.url ?? '',
      created: dashboard.createdAt ? new Date(dashboard.createdAt).toISOString() : '',
      modified: dashboard.modifiedAt ? new Date(dashboard.modifiedAt).toISOString() : '',
      authorHandle: dashboard.authorHandle ?? '',
      // Full widget definitions for learning patterns and cloning
      widgets: dashboard.widgets ?? [],
      // Template variables for parameterized dashboards
      templateVariables: dashboard.templateVariables ?? [],
      // Additional metadata
      tags: dashboard.tags ?? [],
      notifyList: dashboard.notifyList ?? [],
      reflowType: dashboard.reflowType
    }
  }
}

// Common snake_case to camelCase field mappings for Datadog Dashboard API
const SNAKE_TO_CAMEL_FIELDS: Record<string, string> = {
  layout_type: 'layoutType',
  template_variables: 'templateVariables',
  notify_list: 'notifyList',
  reflow_type: 'reflowType',
  is_read_only: 'isReadOnly',
  restricted_roles: 'restrictedRoles'
}

export function normalizeDashboardConfig(config: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...config }

  // Convert snake_case fields to camelCase (always remove snake_case version)
  for (const [snakeCase, camelCase] of Object.entries(SNAKE_TO_CAMEL_FIELDS)) {
    if (snakeCase in normalized) {
      if (!(camelCase in normalized)) {
        normalized[camelCase] = normalized[snakeCase]
      }
      delete normalized[snakeCase]
    }
  }

  // Validate required field
  if (!normalized.layoutType) {
    throw new Error("Dashboard config requires 'layoutType' (e.g., 'ordered', 'free')")
  }

  // Validate tags format if present (must be strings in key:value format)
  if (normalized.tags && Array.isArray(normalized.tags)) {
    const invalidTags = normalized.tags.filter((tag: unknown) => {
      if (typeof tag !== 'string') return true
      // Tags should follow key:value format (e.g., team:ops, env:prod, service:api)
      return !tag.includes(':')
    })
    if (invalidTags.length > 0) {
      throw new Error(
        `Dashboard tags must use key:value format. Invalid tags: ${invalidTags.join(', ')}. Examples: ["team:operations", "env:production", "service:api"]`
      )
    }
  }

  return normalized
}

export async function createDashboard(api: v1.DashboardsApi, config: Record<string, unknown>) {
  const body = normalizeDashboardConfig(config) as unknown as v1.Dashboard
  const dashboard = await api.createDashboard({ body })
  return {
    success: true,
    dashboard: {
      id: dashboard.id ?? '',
      title: dashboard.title ?? '',
      url: dashboard.url ?? ''
    }
  }
}

export async function updateDashboard(
  api: v1.DashboardsApi,
  id: string,
  config: Record<string, unknown>
) {
  const body = normalizeDashboardConfig(config) as unknown as v1.Dashboard
  const dashboard = await api.updateDashboard({ dashboardId: id, body })
  return {
    success: true,
    dashboard: {
      id: dashboard.id ?? '',
      title: dashboard.title ?? '',
      url: dashboard.url ?? ''
    }
  }
}

export async function deleteDashboard(api: v1.DashboardsApi, id: string) {
  await api.deleteDashboard({ dashboardId: id })
  return { success: true, message: `Dashboard ${id} deleted` }
}

export function validateDashboardConfig(config: Record<string, unknown>) {
  try {
    const normalized = normalizeDashboardConfig(config)
    const widgetCount = Array.isArray(normalized.widgets) ? normalized.widgets.length : 0
    const templateVarCount = Array.isArray(normalized.templateVariables)
      ? normalized.templateVariables.length
      : 0

    return {
      valid: true,
      normalized: {
        title: normalized.title,
        layoutType: normalized.layoutType,
        widgetCount,
        templateVariableCount: templateVarCount,
        tags: normalized.tags ?? []
      },
      message: 'Dashboard configuration is valid'
    }
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
      hint: 'Check that layoutType is set and all widgets have valid definitions'
    }
  }
}

export function registerDashboardsTool(
  server: McpServer,
  api: v1.DashboardsApi,
  limits: LimitsConfig,
  readOnly: boolean = false,
  _site: string = 'datadoghq.com'
): void {
  server.tool(
    'dashboards',
    `Access Datadog dashboards and visualizations.

Actions:
- list: Filter dashboards by name/tags
- get: Retrieve full dashboard config including widgets (useful for learning patterns)
- create: Create new dashboard
- update: Modify existing dashboard
- delete: Remove dashboard
- validate: Test dashboard config without creating (helps debug widget definitions)

Widget formats supported:
- Simple: { "type": "timeseries", "requests": [{ "q": "avg:metric{*}" }] }
- Advanced: { "type": "timeseries", "requests": [{ "queries": [...], "formulas": [...] }] }

Tags must use key:value format (e.g., ["team:ops", "env:prod"]).`,
    InputSchema,
    async ({ action, id, name, tags, limit, config }) => {
      try {
        checkReadOnly(action, readOnly)
        switch (action) {
          case 'list':
            return toolResult(await listDashboards(api, { name, tags, limit }, limits))

          case 'get': {
            const dashboardId = requireParam(id, 'id', 'get')
            return toolResult(await getDashboard(api, dashboardId))
          }

          case 'create': {
            const dashboardConfig = requireParam(config, 'config', 'create')
            return toolResult(await createDashboard(api, dashboardConfig))
          }

          case 'update': {
            const dashboardId = requireParam(id, 'id', 'update')
            const updateConfig = requireParam(config, 'config', 'update')
            return toolResult(await updateDashboard(api, dashboardId, updateConfig))
          }

          case 'delete': {
            const dashboardId = requireParam(id, 'id', 'delete')
            return toolResult(await deleteDashboard(api, dashboardId))
          }

          case 'validate': {
            const dashboardConfig = requireParam(config, 'config', 'validate')
            return toolResult(validateDashboardConfig(dashboardConfig))
          }

          default:
            throw new Error(`Unknown action: ${action}`)
        }
      } catch (error) {
        handleDatadogError(error)
      }
    }
  )
}
