import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import { normalizeConfigKeys } from '../utils/normalize.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['list', 'get', 'create', 'update', 'delete', 'reorder', 'get_order'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z.string().optional().describe('Pipeline ID (required for get/update/delete)'),
  config: z
    .record(z.unknown())
    .optional()
    .describe(
      'Pipeline configuration (for create/update). Requires name and filter.query. Processors are forwarded unchanged.'
    ),
  pipeline_ids: z
    .array(z.string())
    .optional()
    .describe('Ordered pipeline ID list (required for reorder)'),
  verbose: z
    .boolean()
    .optional()
    .describe('Return full SDK payload alongside summary (default false)')
}

export interface PipelineSummary {
  id: string
  name: string
  filterQuery: string | null
  isEnabled: boolean
  isReadOnly: boolean
  type: string | null
  processorsCount: number
  processors?: unknown[]
}

export function formatPipeline(p: v1.LogsPipeline, verbose: boolean = false): PipelineSummary {
  const summary: PipelineSummary = {
    id: p.id ?? '',
    name: p.name ?? '',
    filterQuery: p.filter?.query ?? null,
    isEnabled: p.isEnabled ?? false,
    isReadOnly: p.isReadOnly ?? false,
    type: p.type ?? null,
    processorsCount: p.processors?.length ?? 0
  }
  if (verbose && p.processors) {
    summary.processors = p.processors as unknown[]
  }
  return summary
}

/**
 * Normalize and validate a pipeline config payload.
 * Forwards unknown processor types unchanged so Datadog returns its native
 * validation error rather than dropping fields silently.
 */
export function normalizePipelineConfig(config: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeConfigKeys(config) as Record<string, unknown>

  if (!normalized.name) {
    throw new Error("Pipeline config requires 'name' field")
  }
  const filter = normalized.filter as { query?: unknown } | undefined
  if (!filter || typeof filter.query !== 'string' || filter.query.length === 0) {
    throw new Error("Pipeline config requires 'filter.query' field")
  }

  return normalized
}

export async function listPipelines(api: v1.LogsPipelinesApi, verbose: boolean = false) {
  const response = await api.listLogsPipelines()
  const pipelines = (response ?? []).map((p) => formatPipeline(p, verbose))
  const result: Record<string, unknown> = { pipelines, total: pipelines.length }
  if (verbose) {
    result.raw = response
  }
  return result
}

export async function getPipeline(api: v1.LogsPipelinesApi, id: string, verbose: boolean = false) {
  const response = await api.getLogsPipeline({ pipelineId: id })
  const result: Record<string, unknown> = { pipeline: formatPipeline(response, verbose) }
  if (verbose) {
    result.raw = response
  }
  return result
}

export async function createPipeline(
  api: v1.LogsPipelinesApi,
  config: Record<string, unknown>,
  verbose: boolean = false
) {
  const body = normalizePipelineConfig(config) as unknown as v1.LogsPipeline
  const response = await api.createLogsPipeline({ body })
  const result: Record<string, unknown> = {
    success: true,
    pipeline: formatPipeline(response, verbose)
  }
  if (verbose) {
    result.raw = response
  }
  return result
}

export async function updatePipeline(
  api: v1.LogsPipelinesApi,
  id: string,
  config: Record<string, unknown>,
  verbose: boolean = false
) {
  const body = normalizeConfigKeys(config) as unknown as v1.LogsPipeline
  const response = await api.updateLogsPipeline({ pipelineId: id, body })
  const result: Record<string, unknown> = {
    success: true,
    pipeline: formatPipeline(response, verbose)
  }
  if (verbose) {
    result.raw = response
  }
  return result
}

export async function deletePipeline(api: v1.LogsPipelinesApi, id: string) {
  await api.deleteLogsPipeline({ pipelineId: id })
  return {
    success: true,
    message: `Pipeline ${id} deleted`
  }
}

export async function reorderPipelines(api: v1.LogsPipelinesApi, pipelineIds: string[]) {
  const body = { pipelineIds } as v1.LogsPipelinesOrder
  const response = await api.updateLogsPipelineOrder({ body })
  return {
    success: true,
    order: {
      pipelineIds: response.pipelineIds ?? []
    }
  }
}

export async function getPipelineOrder(api: v1.LogsPipelinesApi) {
  const response = await api.getLogsPipelineOrder()
  return {
    order: {
      pipelineIds: response.pipelineIds ?? []
    }
  }
}

export function registerLogsPipelinesTool(
  server: McpServer,
  api: v1.LogsPipelinesApi,
  _limits: LimitsConfig,
  readOnly: boolean = false,
  _site: string = 'datadoghq.com'
): void {
  server.tool(
    'logs_pipelines',
    "Manage Datadog Logs pipelines (parsing & processor chains). Actions: list, get, create, update, delete, reorder, get_order. Pipelines run sequentially on incoming logs; reorder changes the structure of downstream data. Mutations are blocked when the server is in read-only mode. Unknown processor types in 'config.processors' are forwarded to Datadog unchanged.",
    InputSchema,
    async ({ action, id, config, pipeline_ids, verbose }) => {
      try {
        checkReadOnly(action, readOnly)
        const isVerbose = verbose ?? false
        switch (action) {
          case 'list':
            return toolResult(await listPipelines(api, isVerbose))

          case 'get': {
            const pipelineId = requireParam(id, 'id', 'get')
            return toolResult(await getPipeline(api, pipelineId, isVerbose))
          }

          case 'create': {
            const pipelineConfig = requireParam(config, 'config', 'create')
            return toolResult(await createPipeline(api, pipelineConfig, isVerbose))
          }

          case 'update': {
            const pipelineId = requireParam(id, 'id', 'update')
            const pipelineConfig = requireParam(config, 'config', 'update')
            return toolResult(await updatePipeline(api, pipelineId, pipelineConfig, isVerbose))
          }

          case 'delete': {
            const pipelineId = requireParam(id, 'id', 'delete')
            return toolResult(await deletePipeline(api, pipelineId))
          }

          case 'reorder': {
            const ids = requireParam(pipeline_ids, 'pipeline_ids', 'reorder')
            return toolResult(await reorderPipelines(api, ids))
          }

          case 'get_order':
            return toolResult(await getPipelineOrder(api))

          default:
            throw new Error(`Unknown action: ${String(action)}`)
        }
      } catch (error) {
        handleDatadogError(error)
      }
    }
  )
}
