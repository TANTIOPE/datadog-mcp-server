import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v2 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['list', 'get', 'create', 'update', 'cancel', 'listByMonitor'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z.string().optional().describe('Downtime ID (required for get/update/cancel)'),
  monitorId: z.number().optional().describe('Monitor ID (required for listByMonitor)'),
  currentOnly: z.boolean().optional().describe('Only return active downtimes (for list)'),
  limit: z
    .number()
    .min(1)
    .optional()
    .describe('Maximum number of downtimes to return (default: 50)'),
  config: z
    .record(z.unknown())
    .optional()
    .describe('Downtime configuration (for create/update). Must include scope and schedule.')
}

interface DowntimeSummary {
  id: string
  displayTimezone: string
  message: string | null
  monitorIdentifier: {
    monitorId: number | null
    monitorTags: string[]
  }
  scope: string
  status: string
  schedule: unknown
  createdAt: string
  modifiedAt: string
}

export function extractMonitorIdentifier(mi?: v2.DowntimeMonitorIdentifier): {
  monitorId: number | null
  monitorTags: string[]
} {
  if (!mi) return { monitorId: null, monitorTags: [] }

  // Check if it's a DowntimeMonitorIdentifierId (has monitorId property)
  if ('monitorId' in mi && typeof mi.monitorId === 'number') {
    return { monitorId: mi.monitorId, monitorTags: [] }
  }

  // Check if it's a DowntimeMonitorIdentifierTags (has monitorTags property)
  if ('monitorTags' in mi && Array.isArray(mi.monitorTags)) {
    return { monitorId: null, monitorTags: mi.monitorTags }
  }

  return { monitorId: null, monitorTags: [] }
}

export function formatDowntime(d: v2.DowntimeResponseData): DowntimeSummary {
  const attrs = d.attributes
  const status = attrs?.status
  return {
    id: d.id ?? '',
    displayTimezone: attrs?.displayTimezone ?? 'UTC',
    message: attrs?.message ?? null,
    monitorIdentifier: extractMonitorIdentifier(attrs?.monitorIdentifier),
    scope: attrs?.scope ?? '',
    status: typeof status === 'string' ? status : 'unknown',
    schedule: attrs?.schedule ?? null,
    createdAt: attrs?.created ? new Date(attrs.created).toISOString() : '',
    modifiedAt: attrs?.modified ? new Date(attrs.modified).toISOString() : ''
  }
}

export async function listDowntimes(
  api: v2.DowntimesApi,
  params: { currentOnly?: boolean; limit?: number },
  limits: LimitsConfig
) {
  const effectiveLimit = params.limit ?? limits.defaultLimit

  const response = await api.listDowntimes({
    currentOnly: params.currentOnly
  })

  const downtimes = (response.data ?? []).slice(0, effectiveLimit).map(formatDowntime)

  return {
    downtimes,
    total: response.data?.length ?? 0
  }
}

export async function getDowntime(api: v2.DowntimesApi, id: string) {
  const response = await api.getDowntime({ downtimeId: id })
  return {
    downtime: response.data ? formatDowntime(response.data) : null
  }
}

/**
 * Normalize downtime config to handle property name conversion and date formatting
 * - Converts snake_case user input to camelCase for SDK compatibility
 * - One-time schedules: convert ISO strings to Date objects
 * - Recurring schedules: keep dates as strings
 */
export function normalizeDowntimeConfig(config: Record<string, unknown>): Record<string, unknown> {
  // Step 1: Convert top-level snake_case keys to camelCase
  // SDK expects camelCase internally and converts to snake_case for HTTP API
  const keyMapping: Record<string, string> = {
    monitor_identifier: 'monitorIdentifier',
    display_timezone: 'displayTimezone',
    mute_first_recovery_notification: 'muteFirstRecoveryNotification',
    notify_end_states: 'notifyEndStates',
    notify_end_types: 'notifyEndTypes'
  }

  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    const newKey = keyMapping[key] || key
    normalized[newKey] = value
  }

  // Step 2: Handle nested monitorIdentifier conversion (monitor_id → monitorId, monitor_tags → monitorTags)
  if (normalized.monitorIdentifier && typeof normalized.monitorIdentifier === 'object') {
    const mi = { ...(normalized.monitorIdentifier as Record<string, unknown>) }
    if ('monitor_id' in mi) {
      mi.monitorId = mi.monitor_id
      delete mi.monitor_id
    }
    if ('monitor_tags' in mi) {
      mi.monitorTags = mi.monitor_tags
      delete mi.monitor_tags
    }
    normalized.monitorIdentifier = mi
  }

  // Step 3: Handle schedule date conversions and timezone
  if (normalized.schedule && typeof normalized.schedule === 'object') {
    const schedule = { ...(normalized.schedule as Record<string, unknown>) }

    // Detect schedule type:
    // - Recurring if it has 'duration' and 'rrule' fields
    // - One-time otherwise
    const isRecurring = 'duration' in schedule && 'rrule' in schedule

    if (!isRecurring) {
      // One-time schedule: convert ISO string dates to Date objects
      if (schedule.start && typeof schedule.start === 'string') {
        schedule.start = new Date(schedule.start)
      }
      if (schedule.end && typeof schedule.end === 'string') {
        schedule.end = new Date(schedule.end)
      }

      // Move timezone to displayTimezone at top level if present in schedule
      if (schedule.timezone && !normalized.displayTimezone) {
        normalized.displayTimezone = schedule.timezone
      }
      // Remove timezone from one-time schedule (not a valid field)
      delete schedule.timezone
    }
    // For recurring schedules, keep dates as strings (no conversion needed)

    normalized.schedule = schedule
  }

  return normalized
}

export async function createDowntime(api: v2.DowntimesApi, config: Record<string, unknown>) {
  const normalizedConfig = normalizeDowntimeConfig(config)
  const body = {
    data: {
      type: 'downtime' as const,
      attributes: normalizedConfig
    }
  } as unknown as v2.DowntimeCreateRequest

  const response = await api.createDowntime({ body })
  return {
    success: true,
    downtime: response.data ? formatDowntime(response.data) : null
  }
}

export async function updateDowntime(
  api: v2.DowntimesApi,
  id: string,
  config: Record<string, unknown>
) {
  const normalizedConfig = normalizeDowntimeConfig(config)
  const body = {
    data: {
      type: 'downtime' as const,
      id,
      attributes: normalizedConfig
    }
  } as unknown as v2.DowntimeUpdateRequest

  const response = await api.updateDowntime({ downtimeId: id, body })
  return {
    success: true,
    downtime: response.data ? formatDowntime(response.data) : null
  }
}

export async function cancelDowntime(api: v2.DowntimesApi, id: string) {
  await api.cancelDowntime({ downtimeId: id })
  return {
    success: true,
    message: `Downtime ${id} cancelled`
  }
}

interface MonitorDowntimeSummary {
  id: string
  scope: string | null
  start: string | null
  end: string | null
}

export function formatMonitorDowntime(
  d: v2.MonitorDowntimeMatchResponseData
): MonitorDowntimeSummary {
  const attrs = d.attributes
  return {
    id: d.id ?? '',
    scope: attrs?.scope ?? null,
    start: attrs?.start ? new Date(attrs.start).toISOString() : null,
    end: attrs?.end ? new Date(attrs.end).toISOString() : null
  }
}

export async function listMonitorDowntimes(
  api: v2.DowntimesApi,
  monitorId: number,
  _limits: LimitsConfig
) {
  const response = await api.listMonitorDowntimes({ monitorId })
  const downtimes = (response.data ?? []).map(formatMonitorDowntime)

  return {
    downtimes,
    monitorId,
    total: response.data?.length ?? 0
  }
}

export function registerDowntimesTool(
  server: McpServer,
  api: v2.DowntimesApi,
  limits: LimitsConfig,
  readOnly: boolean = false
): void {
  server.tool(
    'downtimes',
    'Manage Datadog scheduled downtimes for maintenance windows. Actions: list, get, create, update, cancel, listByMonitor. Use for: scheduling maintenance, preventing false alerts during deployments, managing recurring maintenance windows.',
    InputSchema,
    async ({ action, id, monitorId, currentOnly, limit, config }) => {
      try {
        checkReadOnly(action, readOnly)
        switch (action) {
          case 'list':
            return toolResult(await listDowntimes(api, { currentOnly, limit }, limits))

          case 'get': {
            const downtimeId = requireParam(id, 'id', 'get')
            return toolResult(await getDowntime(api, downtimeId))
          }

          case 'create': {
            const downtimeConfig = requireParam(config, 'config', 'create')
            return toolResult(await createDowntime(api, downtimeConfig))
          }

          case 'update': {
            const downtimeId = requireParam(id, 'id', 'update')
            const downtimeConfig = requireParam(config, 'config', 'update')
            return toolResult(await updateDowntime(api, downtimeId, downtimeConfig))
          }

          case 'cancel': {
            const downtimeId = requireParam(id, 'id', 'cancel')
            return toolResult(await cancelDowntime(api, downtimeId))
          }

          case 'listByMonitor': {
            const monitor = requireParam(monitorId, 'monitorId', 'listByMonitor')
            return toolResult(await listMonitorDowntimes(api, monitor, limits))
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
