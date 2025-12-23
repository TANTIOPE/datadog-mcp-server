import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1, v2 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import { buildMonitorUrl, buildMonitorsListUrl } from '../utils/urls.js'
import { hoursAgo, now, parseTime, ensureValidTimeRange } from '../utils/time.js'
import { buildEventsUrl } from '../utils/urls.js'
import { formatEventV2 } from './events.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum([
  'list',
  'get',
  'search',
  'create',
  'update',
  'delete',
  'mute',
  'unmute',
  'top'
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
  limit: z
    .number()
    .min(1)
    .optional()
    .describe('Maximum number of monitors to return (default: 50)'),
  config: z.record(z.unknown()).optional().describe('Monitor configuration (for create/update)'),
  message: z.string().optional().describe('Mute message (for mute action)'),
  end: z.number().optional().describe('Mute end timestamp (for mute action)'),
  // Top action parameters
  from: z
    .string()
    .optional()
    .describe('Start time (ISO 8601, relative like "1h", or Unix timestamp)'),
  to: z.string().optional().describe('End time (ISO 8601, relative like "1h", or Unix timestamp)'),
  contextTags: z
    .array(z.string())
    .optional()
    .describe(
      'Tag prefixes for context breakdown in top action (default: queue, service, ingress, pod_name, kube_namespace, kube_container_name)'
    ),
  maxEvents: z
    .number()
    .min(1)
    .max(5000)
    .optional()
    .describe('Maximum events to fetch for top action (default: 5000, max: 5000)')
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
  const effectiveLimit = params.limit ?? limits.defaultLimit

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
  const monitors = (response.monitors ?? []).map((m) => ({
    id: m.id ?? 0,
    name: m.name ?? '',
    status: String(m.status ?? 'unknown'),
    type: m.type ?? '',
    tags: m.tags ?? [],
    url: buildMonitorUrl(m.id ?? 0, site)
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

/**
 * Top N monitors with real names and context breakdown
 * Fetches alert events, groups by monitor_id, and enriches with real monitor names from monitors API
 */
export async function topMonitors(
  eventsApi: v2.EventsApi,
  monitorsApi: v1.MonitorsApi,
  params: {
    from?: string
    to?: string
    tags?: string[]
    limit?: number
    contextTags?: string[]
    maxEvents?: number
  },
  limits: LimitsConfig,
  site: string
) {
  // Time range setup
  const defaultFrom = hoursAgo(limits.defaultTimeRangeHours)
  const defaultTo = now()
  const [validFrom, validTo] = ensureValidTimeRange(
    parseTime(params.from, defaultFrom),
    parseTime(params.to, defaultTo)
  )
  const fromTime = new Date(validFrom * 1000).toISOString()
  const toTime = new Date(validTo * 1000).toISOString()

  // Build query for alert events
  const queryParts: string[] = ['source:alert']
  if (params.tags) {
    queryParts.push(...params.tags)
  }
  const query = queryParts.join(' ')

  // Step 1: Fetch alert events
  const searchResponse = await eventsApi.searchEvents({
    body: {
      filter: {
        query,
        from: fromTime,
        to: toTime
      },
      page: {
        limit: Math.min(params.maxEvents ?? 5000, 5000)
      },
      sort: 'timestamp'
    }
  })

  const rawEvents = searchResponse.data ?? []

  // Format events to extract monitor_id and parse structure
  const events = rawEvents.map(formatEventV2)

  // Step 2: Group by monitor_id + extract context
  const contextPrefixes = new Set(
    params.contextTags ?? [
      'queue',
      'service',
      'ingress',
      'pod_name',
      'kube_namespace',
      'kube_container_name'
    ]
  )

  const monitorGroups = new Map<
    number,
    {
      monitorId: number
      eventCount: number
      contextBreakdown: Map<string, number>
    }
  >()

  for (const event of events) {
    const monitorId = event.monitorId
    if (typeof monitorId !== 'number') continue

    let group = monitorGroups.get(monitorId)
    if (!group) {
      group = {
        monitorId,
        eventCount: 0,
        contextBreakdown: new Map()
      }
      monitorGroups.set(monitorId, group)
    }
    group.eventCount++

    // Extract context tag
    const tags = event.tags
    for (const prefix of contextPrefixes) {
      const tag = tags.find((t) => t.startsWith(`${prefix}:`))
      if (tag) {
        group.contextBreakdown.set(tag, (group.contextBreakdown.get(tag) || 0) + 1)
        break // Only count first matching context tag
      }
    }
  }

  // Step 3: Fetch real monitor names for unique monitor_ids
  const monitorIds = Array.from(monitorGroups.keys())
  const monitorNames = new Map<number, { name: string; message: string }>()

  for (const monitorId of monitorIds) {
    try {
      const monitor = await monitorsApi.getMonitor({ monitorId })
      monitorNames.set(monitorId, {
        name: monitor.name ?? `Monitor ${monitorId}`,
        message: monitor.message ?? ''
      })
    } catch {
      // Fallback if monitor fetch fails (e.g., deleted monitor)
      monitorNames.set(monitorId, {
        name: `Monitor ${monitorId}`,
        message: ''
      })
    }
  }

  // Step 4: Build result with real monitor names
  const topMonitors = Array.from(monitorGroups.values())
    .map((group) => {
      const monitorInfo = monitorNames.get(group.monitorId) ?? {
        name: `Monitor ${group.monitorId}`,
        message: ''
      }

      return {
        monitor_id: group.monitorId,
        name: monitorInfo.name,
        message: monitorInfo.message,
        total_count: group.eventCount,
        by_context: Array.from(group.contextBreakdown.entries())
          .map(([context, count]) => ({ context, count }))
          .sort((a, b) => b.count - a.count)
      }
    })
    .filter((monitor) => monitor.by_context.length > 0) // Filter out monitors without context tags
    .sort((a, b) => b.total_count - a.total_count)
    .slice(0, params.limit ?? 10)
    .map((m, i) => ({ rank: i + 1, ...m }))

  return {
    top: topMonitors,
    meta: {
      query,
      from: fromTime,
      to: toTime,
      totalMonitors: monitorGroups.size,
      totalEvents: events.length,
      contextPrefixes: Array.from(contextPrefixes),
      datadog_url: buildEventsUrl(query, validFrom, validTo, site)
    }
  }
}

export function registerMonitorsTool(
  server: McpServer,
  api: v1.MonitorsApi,
  eventsApi: v2.EventsApi,
  limits: LimitsConfig,
  readOnly: boolean = false,
  site: string = 'datadoghq.com'
): void {
  server.tool(
    'monitors',
    `Manage Datadog monitors. Actions: list, get, search, create, update, delete, mute, unmute, top.
Filters: name, tags, groupStates (alert/warn/ok/no data).

top: Ranked monitors by alert frequency with real monitor names and context breakdown.
  - Returns: {rank, monitor_id, name (with {{template.vars}}), message (template), total_count, by_context}
  - Perfect for weekly/daily alert reports
  - Gets real monitor names from monitors API (not event titles)

For generic event grouping (deployments, configs), use events tool instead.`,
    InputSchema,
    async ({
      action,
      id,
      query,
      name,
      tags,
      groupStates,
      limit,
      config,
      end,
      from,
      to,
      contextTags,
      maxEvents
    }) => {
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

          case 'top':
            return toolResult(
              await topMonitors(
                eventsApi,
                api,
                {
                  from,
                  to,
                  tags,
                  limit,
                  contextTags,
                  maxEvents
                },
                limits,
                site
              )
            )

          default:
            throw new Error(`Unknown action: ${action}`)
        }
      } catch (error) {
        handleDatadogError(error)
      }
    }
  )
}
