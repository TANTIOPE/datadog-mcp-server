import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import { buildMonitorUrl, buildMonitorsListUrl } from '../utils/urls.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum([
  'list',
  'get',
  'search',
  'create',
  'update',
  'delete',
  'mute',
  'unmute'
])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z.string().optional().describe('Monitor ID (required for get/update/delete/mute/unmute)'),
  query: z.string().optional().describe('Search query (for search action)'),
  name: z.string().optional().describe('Filter by name (for list action)'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  groupStates: z
    .array(z.string())
    .optional()
    .describe(
      'Filter multi-alert monitors by group states (e.g., alert by host). Does NOT filter by overall monitor status. Values: alert, warn, no data, ok'
    ),
  limit: z.number().optional().describe('Maximum number of monitors to return'),
  config: z.record(z.unknown()).optional().describe('Monitor configuration (for create/update)'),
  message: z.string().optional().describe('Mute message (for mute action)'),
  end: z.number().optional().describe('Mute end timestamp (for mute action)')
}

interface MonitorSummary {
  id: number
  name: string
  type: string
  status: string
  message: string
  tags: string[]
  query: string
  created: string
  modified: string
  url: string
}

export function formatMonitor(m: v1.Monitor, site: string = 'datadoghq.com'): MonitorSummary {
  const monitorId = m.id ?? 0
  return {
    id: monitorId,
    name: m.name ?? '',
    type: String(m.type ?? 'unknown'),
    status: String(m.overallState ?? 'unknown'),
    message: m.message ?? '',
    tags: m.tags ?? [],
    query: m.query ?? '',
    created: m.created ? new Date(m.created).toISOString() : '',
    modified: m.modified ? new Date(m.modified).toISOString() : '',
    url: buildMonitorUrl(monitorId, site)
  }
}

export async function listMonitors(
  api: v1.MonitorsApi,
  params: { name?: string; tags?: string[]; groupStates?: string[]; limit?: number },
  limits: LimitsConfig,
  site: string
) {
  const effectiveLimit = Math.min(params.limit ?? limits.maxResults, limits.maxResults)

  const response = await api.listMonitors({
    name: params.name,
    tags: params.tags?.join(','),
    groupStates: params.groupStates?.join(',')
  })

  const monitors = response.slice(0, effectiveLimit).map((m) => formatMonitor(m, site))

  const statusCounts = {
    total: response.length,
    alert: response.filter((m) => m.overallState === 'Alert').length,
    warn: response.filter((m) => m.overallState === 'Warn').length,
    ok: response.filter((m) => m.overallState === 'OK').length,
    noData: response.filter((m) => m.overallState === 'No Data').length
  }

  return {
    monitors,
    summary: statusCounts,
    datadog_url: buildMonitorsListUrl(
      { name: params.name, tags: params.tags, groupStates: params.groupStates },
      site
    )
  }
}

export async function getMonitor(api: v1.MonitorsApi, id: string, site: string) {
  const monitorId = Number.parseInt(id, 10)
  if (Number.isNaN(monitorId)) {
    throw new Error(`Invalid monitor ID: ${id}`)
  }

  const monitor = await api.getMonitor({ monitorId })
  return {
    monitor: formatMonitor(monitor, site),
    datadog_url: buildMonitorUrl(monitorId, site)
  }
}

export async function searchMonitors(
  api: v1.MonitorsApi,
  query: string,
  limits: LimitsConfig,
  site: string
) {
  const response = await api.searchMonitors({ query })
  const monitors = (response.monitors ?? []).slice(0, limits.maxResults).map((m) => ({
    id: m.id ?? 0,
    name: m.name ?? '',
    status: String(m.status ?? 'unknown'),
    type: m.type ?? '',
    tags: m.tags ?? []
  }))

  return {
    monitors,
    metadata: {
      totalCount: response.metadata?.totalCount ?? monitors.length,
      pageCount: response.metadata?.pageCount ?? 1,
      page: response.metadata?.page ?? 0
    },
    datadog_url: buildMonitorsListUrl({ name: query }, site)
  }
}

/**
 * Normalize monitor config to handle snake_case -> camelCase conversion
 * Common fields that users might pass in snake_case
 */
export function normalizeMonitorConfig(
  config: Record<string, unknown>,
  isUpdate: boolean = false
): Record<string, unknown> {
  const normalized = { ...config }

  // Required field validation (only for create, not update)
  if (!isUpdate && !normalized.name && !normalized.type && !normalized.query) {
    throw new Error("Monitor config requires at least 'name', 'type', and 'query' fields")
  }

  // Handle options object snake_case conversions
  if (normalized.options && typeof normalized.options === 'object') {
    const opts = { ...(normalized.options as Record<string, unknown>) }

    // Common snake_case -> camelCase conversions
    const optionMappings: [string, string][] = [
      ['notify_no_data', 'notifyNoData'],
      ['no_data_timeframe', 'noDataTimeframe'],
      ['new_host_delay', 'newHostDelay'],
      ['new_group_delay', 'newGroupDelay'],
      ['evaluation_delay', 'evaluationDelay'],
      ['renotify_interval', 'renotifyInterval'],
      ['renotify_occurrences', 'renotifyOccurrences'],
      ['renotify_statuses', 'renotifyStatuses'],
      ['timeout_h', 'timeoutH'],
      ['notify_audit', 'notifyAudit'],
      ['include_tags', 'includeTags'],
      ['require_full_window', 'requireFullWindow'],
      ['escalation_message', 'escalationMessage'],
      ['locked', 'locked'],
      ['silenced', 'silenced']
    ]

    for (const [snake, camel] of optionMappings) {
      if (snake in opts && !(camel in opts)) {
        opts[camel] = opts[snake]
        delete opts[snake]
      }
    }

    // Handle nested thresholds
    if (opts.thresholds && typeof opts.thresholds === 'object') {
      const thresholds = { ...(opts.thresholds as Record<string, unknown>) }
      const thresholdMappings: [string, string][] = [
        ['critical', 'critical'],
        ['warning', 'warning'],
        ['ok', 'ok'],
        ['critical_recovery', 'criticalRecovery'],
        ['warning_recovery', 'warningRecovery']
      ]
      for (const [snake, camel] of thresholdMappings) {
        if (snake in thresholds && !(camel in thresholds) && snake !== camel) {
          thresholds[camel] = thresholds[snake]
          delete thresholds[snake]
        }
      }
      opts.thresholds = thresholds
    }

    normalized.options = opts
  }

  return normalized
}

export async function createMonitor(
  api: v1.MonitorsApi,
  config: Record<string, unknown>,
  site: string = 'datadoghq.com'
) {
  const body = normalizeMonitorConfig(config) as unknown as v1.Monitor
  const monitor = await api.createMonitor({ body })
  return {
    success: true,
    monitor: formatMonitor(monitor, site)
  }
}

export async function updateMonitor(
  api: v1.MonitorsApi,
  id: string,
  config: Record<string, unknown>,
  site: string = 'datadoghq.com'
) {
  const monitorId = Number.parseInt(id, 10)
  const body = normalizeMonitorConfig(config, true) as unknown as v1.MonitorUpdateRequest
  const monitor = await api.updateMonitor({ monitorId, body })
  return {
    success: true,
    monitor: formatMonitor(monitor, site)
  }
}

export async function deleteMonitor(api: v1.MonitorsApi, id: string) {
  const monitorId = Number.parseInt(id, 10)
  await api.deleteMonitor({ monitorId })
  return { success: true, message: `Monitor ${id} deleted` }
}

export async function muteMonitor(api: v1.MonitorsApi, id: string, params: { end?: number }) {
  const monitorId = Number.parseInt(id, 10)
  // Use validate endpoint with mute options
  const monitor = await api.getMonitor({ monitorId })

  // Update the monitor with mute options
  await api.updateMonitor({
    monitorId,
    body: {
      options: {
        ...monitor.options,
        silenced: { '*': params.end ?? null }
      }
    } as unknown as v1.MonitorUpdateRequest
  })
  return { success: true, message: `Monitor ${id} muted` }
}

export async function unmuteMonitor(api: v1.MonitorsApi, id: string) {
  const monitorId = Number.parseInt(id, 10)
  const monitor = await api.getMonitor({ monitorId })

  // Update the monitor to remove silenced option
  await api.updateMonitor({
    monitorId,
    body: {
      options: {
        ...monitor.options,
        silenced: {}
      }
    } as unknown as v1.MonitorUpdateRequest
  })
  return { success: true, message: `Monitor ${id} unmuted` }
}

export function registerMonitorsTool(
  server: McpServer,
  api: v1.MonitorsApi,
  limits: LimitsConfig,
  readOnly: boolean = false,
  site: string = 'datadoghq.com'
): void {
  server.tool(
    'monitors',
    `Manage Datadog monitors. Actions: list, get, search, create, update, delete, mute, unmute.
Filters: name, tags, groupStates (alert/warn/ok/no data).
TIP: For alert HISTORY (which monitors triggered), use the events tool with tags: ["source:alert"].`,
    InputSchema,
    async ({ action, id, query, name, tags, groupStates, limit, config, end }) => {
      try {
        checkReadOnly(action, readOnly)
        switch (action) {
          case 'list':
            return toolResult(
              await listMonitors(api, { name, tags, groupStates, limit }, limits, site)
            )

          case 'get': {
            const monitorId = requireParam(id, 'id', 'get')
            return toolResult(await getMonitor(api, monitorId, site))
          }

          case 'search': {
            const searchQuery = requireParam(query, 'query', 'search')
            return toolResult(await searchMonitors(api, searchQuery, limits, site))
          }

          case 'create': {
            const monitorConfig = requireParam(config, 'config', 'create')
            return toolResult(await createMonitor(api, monitorConfig, site))
          }

          case 'update': {
            const monitorId = requireParam(id, 'id', 'update')
            const updateConfig = requireParam(config, 'config', 'update')
            return toolResult(await updateMonitor(api, monitorId, updateConfig, site))
          }

          case 'delete': {
            const monitorId = requireParam(id, 'id', 'delete')
            return toolResult(await deleteMonitor(api, monitorId))
          }

          case 'mute': {
            const monitorId = requireParam(id, 'id', 'mute')
            return toolResult(await muteMonitor(api, monitorId, { end }))
          }

          case 'unmute': {
            const monitorId = requireParam(id, 'id', 'unmute')
            return toolResult(await unmuteMonitor(api, monitorId))
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
