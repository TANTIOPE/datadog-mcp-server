import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['list', 'get', 'create', 'update', 'delete'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z.string().optional().describe('Dashboard ID (required for get/update/delete)'),
  name: z.string().optional().describe('Filter by name'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  limit: z.number().optional().describe('Maximum number of dashboards to return'),
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
  const effectiveLimit = Math.min(params.limit ?? limits.maxResults, limits.maxResults)

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
      widgets: dashboard.widgets?.length ?? 0,
      url: dashboard.url ?? '',
      created: dashboard.createdAt ? new Date(dashboard.createdAt).toISOString() : '',
      modified: dashboard.modifiedAt ? new Date(dashboard.modifiedAt).toISOString() : '',
      authorHandle: dashboard.authorHandle ?? ''
    }
  }
}

export function normalizeDashboardConfig(config: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...config }

  // Handle layout_type -> layoutType
  if ('layout_type' in normalized && !('layoutType' in normalized)) {
    normalized.layoutType = normalized.layout_type
    delete normalized.layout_type
  }

  // Validate required field
  if (!normalized.layoutType) {
    throw new Error("Dashboard config requires 'layoutType' (e.g., 'ordered', 'free')")
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

export function registerDashboardsTool(
  server: McpServer,
  api: v1.DashboardsApi,
  limits: LimitsConfig,
  readOnly: boolean = false,
  _site: string = 'datadoghq.com'
): void {
  server.tool(
    'dashboards',
    'Access Datadog dashboards and visualizations. Actions: list (filter by name/tags), get, create, update, delete. Use for: finding existing views, team dashboards, understanding what is monitored.',
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

          default:
            throw new Error(`Unknown action: ${action}`)
        }
      } catch (error) {
        handleDatadogError(error)
      }
    }
  )
}
