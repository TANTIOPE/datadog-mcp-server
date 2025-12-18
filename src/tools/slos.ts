import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import { parseTime, ensureValidTimeRange } from '../utils/time.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['list', 'get', 'create', 'update', 'delete', 'history'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z.string().optional().describe('SLO ID (required for get/update/delete/history)'),
  ids: z.array(z.string()).optional().describe('Multiple SLO IDs (for list with specific IDs)'),
  query: z.string().optional().describe('Search query (for list)'),
  tags: z.array(z.string()).optional().describe('Filter by tags (for list)'),
  limit: z.number().optional().describe('Maximum number of SLOs to return'),
  config: z
    .record(z.unknown())
    .optional()
    .describe('SLO configuration (for create/update). Must include type, name, thresholds.'),
  from: z
    .string()
    .optional()
    .describe('Start time for history (ISO 8601 or relative like "7d", "1w")'),
  to: z.string().optional().describe('End time for history (ISO 8601 or relative, default: now)')
}

interface SloSummary {
  id: string
  name: string
  description: string | null
  type: string
  targetThreshold: number
  warningThreshold: number | null
  timeframe: string
  tags: string[]
  status: {
    sli: number | null
    errorBudgetRemaining: number | null
    state: string
  }
  createdAt: string
  modifiedAt: string
}

export function formatSlo(s: v1.ServiceLevelObjective | v1.SLOResponseData): SloSummary {
  const primaryThreshold = s.thresholds?.[0]
  return {
    id: s.id ?? '',
    name: s.name ?? '',
    description: s.description ?? null,
    type: String(s.type ?? 'unknown'),
    targetThreshold: primaryThreshold?.target ?? 0,
    warningThreshold: primaryThreshold?.warning ?? null,
    timeframe: String(primaryThreshold?.timeframe ?? ''),
    tags: s.tags ?? [],
    status: {
      // Note: SLI status requires a separate API call to getSLOHistory
      sli: null,
      errorBudgetRemaining: null,
      state: 'unknown'
    },
    createdAt: s.createdAt ? new Date(s.createdAt * 1000).toISOString() : '',
    modifiedAt: s.modifiedAt ? new Date(s.modifiedAt * 1000).toISOString() : ''
  }
}

export async function listSlos(
  api: v1.ServiceLevelObjectivesApi,
  params: { ids?: string[]; query?: string; tags?: string[]; limit?: number },
  limits: LimitsConfig
) {
  const effectiveLimit = Math.min(params.limit ?? limits.maxResults, limits.maxResults)

  const response = await api.listSLOs({
    ids: params.ids?.join(','),
    query: params.query,
    tagsQuery: params.tags?.join(','),
    limit: effectiveLimit
  })

  const slos = (response.data ?? []).map(formatSlo)

  return {
    slos,
    total: response.data?.length ?? 0
  }
}

export async function getSlo(api: v1.ServiceLevelObjectivesApi, id: string) {
  const response = await api.getSLO({ sloId: id })
  return {
    slo: response.data ? formatSlo(response.data) : null
  }
}

/**
 * Recursively convert snake_case keys to camelCase
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

export function normalizeConfigKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(normalizeConfigKeys)
  if (typeof obj !== 'object') return obj

  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const camelKey = snakeToCamel(key)
    normalized[camelKey] = normalizeConfigKeys(value)
  }
  return normalized
}

/**
 * Normalize SLO config to handle snake_case -> camelCase
 */
export function normalizeSloConfig(config: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeConfigKeys(config) as Record<string, unknown>

  // Validate required fields
  if (!normalized.name) {
    throw new Error("SLO config requires 'name' field")
  }
  if (!normalized.type) {
    throw new Error("SLO config requires 'type' field (e.g., 'metric', 'monitor')")
  }
  if (!normalized.thresholds || !Array.isArray(normalized.thresholds)) {
    throw new Error("SLO config requires 'thresholds' array with at least one threshold")
  }

  return normalized
}

export async function createSlo(api: v1.ServiceLevelObjectivesApi, config: Record<string, unknown>) {
  const body = normalizeSloConfig(config) as unknown as v1.ServiceLevelObjectiveRequest
  const response = await api.createSLO({ body })
  return {
    success: true,
    slo: response.data?.[0] ? formatSlo(response.data[0]) : null
  }
}

export async function updateSlo(
  api: v1.ServiceLevelObjectivesApi,
  id: string,
  config: Record<string, unknown>
) {
  const body = normalizeConfigKeys(config) as unknown as v1.ServiceLevelObjective
  const response = await api.updateSLO({ sloId: id, body })
  return {
    success: true,
    slo: response.data?.[0] ? formatSlo(response.data[0]) : null
  }
}

export async function deleteSlo(api: v1.ServiceLevelObjectivesApi, id: string) {
  await api.deleteSLO({ sloId: id })
  return {
    success: true,
    message: `SLO ${id} deleted`
  }
}

export async function getSloHistory(
  api: v1.ServiceLevelObjectivesApi,
  id: string,
  params: { from?: string; to?: string }
) {
  const nowMs = Date.now()
  const defaultFromMs = nowMs - 7 * 24 * 60 * 60 * 1000 // Default 7 days
  const fromTime = parseTime(params.from, Math.floor(defaultFromMs / 1000)) * 1000
  const toTime = parseTime(params.to, Math.floor(nowMs / 1000)) * 1000

  const [validFrom, validTo] = ensureValidTimeRange(fromTime, toTime)

  const response = await api.getSLOHistory({
    sloId: id,
    fromTs: Math.floor(validFrom / 1000),
    toTs: Math.floor(validTo / 1000)
  })

  const data = response.data
  return {
    history: {
      overall: {
        sliValue: data?.overall?.sliValue ?? null,
        spanPrecision: data?.overall?.spanPrecision ?? null,
        uptime: data?.overall?.uptime ?? null
      },
      series: {
        numerator: data?.series?.numerator?.values ?? [],
        denominator: data?.series?.denominator?.values ?? [],
        times: data?.series?.times ?? []
      },
      thresholds: data?.thresholds ?? {},
      fromTs: new Date(validFrom).toISOString(),
      toTs: new Date(validTo).toISOString()
    }
  }
}

export function registerSlosTool(
  server: McpServer,
  api: v1.ServiceLevelObjectivesApi,
  limits: LimitsConfig,
  readOnly: boolean = false,
  _site: string = 'datadoghq.com'
): void {
  server.tool(
    'slos',
    'Manage Datadog Service Level Objectives. Actions: list, get, create, update, delete, history. SLO types: metric-based, monitor-based. Use for: reliability tracking, error budgets, SLA compliance, performance targets.',
    InputSchema,
    async ({ action, id, ids, query, tags, limit, config, from, to }) => {
      try {
        checkReadOnly(action, readOnly)
        switch (action) {
          case 'list':
            return toolResult(await listSlos(api, { ids, query, tags, limit }, limits))

          case 'get': {
            const sloId = requireParam(id, 'id', 'get')
            return toolResult(await getSlo(api, sloId))
          }

          case 'create': {
            const sloConfig = requireParam(config, 'config', 'create')
            return toolResult(await createSlo(api, sloConfig))
          }

          case 'update': {
            const sloId = requireParam(id, 'id', 'update')
            const sloConfig = requireParam(config, 'config', 'update')
            return toolResult(await updateSlo(api, sloId, sloConfig))
          }

          case 'delete': {
            const sloId = requireParam(id, 'id', 'delete')
            return toolResult(await deleteSlo(api, sloId))
          }

          case 'history': {
            const sloId = requireParam(id, 'id', 'history')
            return toolResult(await getSloHistory(api, sloId, { from, to }))
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
