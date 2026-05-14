import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import { normalizeConfigKeys } from '../utils/normalize.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['list', 'get', 'update', 'reorder', 'get_order'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  name: z
    .string()
    .optional()
    .describe('Index name (required for get/update). Datadog identifies indexes by name, not id.'),
  config: z
    .record(z.unknown())
    .optional()
    .describe(
      'Index configuration (for update). Requires filter.query and numRetentionDays. Exclusion filters are forwarded unchanged.'
    ),
  index_names: z
    .array(z.string())
    .optional()
    .describe('Ordered index name list (required for reorder)'),
  verbose: z
    .boolean()
    .optional()
    .describe('Return full SDK payload alongside summary (default false)')
}

export interface IndexSummary {
  name: string
  filterQuery: string | null
  exclusionFiltersCount: number
  numRetentionDays: number | null
  numFlexLogsRetentionDays: number | null
  dailyLimit: number | null
  isRateLimited: boolean
  exclusionFilters?: unknown[]
}

export function formatIndex(idx: v1.LogsIndex, verbose: boolean = false): IndexSummary {
  const summary: IndexSummary = {
    name: idx.name ?? '',
    filterQuery: idx.filter?.query ?? null,
    exclusionFiltersCount: idx.exclusionFilters?.length ?? 0,
    numRetentionDays: idx.numRetentionDays ?? null,
    numFlexLogsRetentionDays: idx.numFlexLogsRetentionDays ?? null,
    dailyLimit: idx.dailyLimit ?? null,
    isRateLimited: idx.isRateLimited ?? false
  }
  if (verbose && idx.exclusionFilters) {
    summary.exclusionFilters = idx.exclusionFilters as unknown[]
  }
  return summary
}

/**
 * Normalize and validate an index update payload.
 * Datadog's update endpoint requires `filter.query` and `numRetentionDays`.
 * Unknown fields (exclusion filters, daily limit options) are forwarded unchanged.
 */
export function normalizeIndexConfig(config: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeConfigKeys(config) as Record<string, unknown>

  const filter = normalized.filter as { query?: unknown } | undefined
  if (!filter || typeof filter.query !== 'string' || filter.query.length === 0) {
    throw new Error("Index config requires 'filter.query' field")
  }
  if (typeof normalized.numRetentionDays !== 'number') {
    throw new Error("Index config requires 'numRetentionDays' field")
  }

  return normalized
}

export async function listIndexes(api: v1.LogsIndexesApi, verbose: boolean = false) {
  const response = await api.listLogIndexes()
  const indexes = (response.indexes ?? []).map((idx) => formatIndex(idx, verbose))
  const result: Record<string, unknown> = { indexes, total: indexes.length }
  if (verbose) {
    result.raw = response
  }
  return result
}

export async function getIndex(api: v1.LogsIndexesApi, name: string, verbose: boolean = false) {
  const response = await api.getLogsIndex({ name })
  const result: Record<string, unknown> = { index: formatIndex(response, verbose) }
  if (verbose) {
    result.raw = response
  }
  return result
}

export async function updateIndex(
  api: v1.LogsIndexesApi,
  name: string,
  config: Record<string, unknown>,
  verbose: boolean = false
) {
  const body = normalizeIndexConfig(config) as unknown as v1.LogsIndexUpdateRequest
  const response = await api.updateLogsIndex({ name, body })
  const result: Record<string, unknown> = {
    success: true,
    index: formatIndex(response, verbose)
  }
  if (verbose) {
    result.raw = response
  }
  return result
}

export async function reorderIndexes(api: v1.LogsIndexesApi, indexNames: string[]) {
  const body = { indexNames } as v1.LogsIndexesOrder
  const response = await api.updateLogsIndexOrder({ body })
  return {
    success: true,
    order: {
      indexNames: response.indexNames ?? []
    }
  }
}

export async function getIndexOrder(api: v1.LogsIndexesApi) {
  const response = await api.getLogsIndexOrder()
  return {
    order: {
      indexNames: response.indexNames ?? []
    }
  }
}

export function registerLogsIndexesTool(
  server: McpServer,
  api: v1.LogsIndexesApi,
  _limits: LimitsConfig,
  readOnly: boolean = false,
  _site: string = 'datadoghq.com'
): void {
  server.tool(
    'logs_indexes',
    "Manage Datadog Logs indexes (filters, retention, exclusion filters, daily limits). Actions: list, get, update, reorder, get_order. Datadog identifies indexes by 'name', not 'id'. Note: create/delete are UI-only per Datadog and not supported through the API. Mutations (update, reorder) are blocked when the server is in read-only mode.",
    InputSchema,
    async ({ action, name, config, index_names, verbose }) => {
      try {
        checkReadOnly(action, readOnly)
        const isVerbose = verbose ?? false
        switch (action) {
          case 'list':
            return toolResult(await listIndexes(api, isVerbose))

          case 'get': {
            const indexName = requireParam(name, 'name', 'get')
            return toolResult(await getIndex(api, indexName, isVerbose))
          }

          case 'update': {
            const indexName = requireParam(name, 'name', 'update')
            const indexConfig = requireParam(config, 'config', 'update')
            return toolResult(await updateIndex(api, indexName, indexConfig, isVerbose))
          }

          case 'reorder': {
            const names = requireParam(index_names, 'index_names', 'reorder')
            return toolResult(await reorderIndexes(api, names))
          }

          case 'get_order':
            return toolResult(await getIndexOrder(api))

          default:
            throw new Error(`Unknown action: ${String(action)}`)
        }
      } catch (error) {
        handleDatadogError(error)
      }
    }
  )
}
