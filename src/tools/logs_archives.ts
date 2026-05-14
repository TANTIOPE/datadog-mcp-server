import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v2 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import { normalizeConfigKeys } from '../utils/normalize.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['list', 'get', 'create', 'update', 'delete', 'reorder', 'get_order'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z.string().optional().describe('Archive ID (required for get/update/delete)'),
  config: z
    .record(z.unknown())
    .optional()
    .describe(
      'Archive configuration (for create/update). Requires name, query, and destination with type ∈ { s3, gcs, azure_storage }. Provider credential / integration fields are forwarded unchanged.'
    ),
  archive_ids: z
    .array(z.string())
    .optional()
    .describe('Ordered archive ID list (required for reorder)'),
  verbose: z
    .boolean()
    .optional()
    .describe('Return full SDK payload alongside summary (default false)')
}

const VALID_DESTINATION_TYPES = ['s3', 'gcs', 'azure_storage'] as const

export interface ArchiveSummary {
  id: string
  name: string
  query: string | null
  destinationType: string
  destinationContainer: string | null
  includeTags: boolean
  rehydrationTags: string[]
  state: string | null
  destination?: unknown
}

/**
 * Extract the storage container (bucket or Azure container) from a destination.
 * S3 + GCS expose `bucket`; Azure exposes `container`. Returns null when the
 * destination is missing or the provider exposes neither field.
 */
function extractDestinationContainer(destination: unknown): string | null {
  if (!destination || typeof destination !== 'object') return null
  const dest = destination as { bucket?: unknown; container?: unknown }
  if (typeof dest.bucket === 'string') return dest.bucket
  if (typeof dest.container === 'string') return dest.container
  return null
}

export function formatArchive(
  archive: v2.LogsArchiveDefinition,
  verbose: boolean = false
): ArchiveSummary {
  const attrs = archive.attributes
  const destination = attrs?.destination ?? null
  const destinationType =
    destination && typeof destination === 'object' && 'type' in destination
      ? String((destination as { type: unknown }).type ?? '')
      : ''

  const summary: ArchiveSummary = {
    id: archive.id ?? '',
    name: attrs?.name ?? '',
    query: attrs?.query ?? null,
    destinationType,
    destinationContainer: extractDestinationContainer(destination),
    includeTags: attrs?.includeTags ?? false,
    rehydrationTags: attrs?.rehydrationTags ?? [],
    state: (attrs?.state as string | undefined) ?? null
  }
  if (verbose && destination) {
    summary.destination = destination
  }
  return summary
}

/**
 * Normalize and validate an archive create/update payload.
 *
 * - Normalizes snake_case keys recursively (per project convention).
 * - Validates `name`, `query`, and `destination.type ∈ { s3, gcs, azure_storage }`.
 * - Forwards per-provider credential / integration fields unchanged so the SDK
 *   can pass them through to Datadog without local introspection.
 */
export function normalizeArchiveConfig(config: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeConfigKeys(config) as Record<string, unknown>

  if (typeof normalized.name !== 'string' || normalized.name.length === 0) {
    throw new Error("Archive config requires 'name' field")
  }
  if (typeof normalized.query !== 'string' || normalized.query.length === 0) {
    throw new Error("Archive config requires 'query' field")
  }

  const destination = normalized.destination as { type?: unknown } | undefined
  if (!destination || typeof destination !== 'object') {
    throw new Error("Archive config requires 'destination' object")
  }
  const destinationType = destination.type
  if (
    typeof destinationType !== 'string' ||
    !VALID_DESTINATION_TYPES.includes(destinationType as (typeof VALID_DESTINATION_TYPES)[number])
  ) {
    throw new Error('destination.type must be one of: s3, gcs, azure_storage')
  }

  return normalized
}

/**
 * Build a LogsArchiveCreateRequest body from a normalized config payload.
 * The destination is forwarded unchanged so provider-specific credential
 * fields survive round-trip without local validation.
 */
function buildArchiveRequestBody(
  normalizedConfig: Record<string, unknown>
): v2.LogsArchiveCreateRequest {
  const { name, query, destination, includeTags, rehydrationTags, rehydrationMaxScanSizeInGb } =
    normalizedConfig as {
      name: string
      query: string
      destination: unknown
      includeTags?: unknown
      rehydrationTags?: unknown
      rehydrationMaxScanSizeInGb?: unknown
    }

  const attributes: Record<string, unknown> = {
    name,
    query,
    destination
  }
  if (includeTags !== undefined) attributes.includeTags = includeTags
  if (rehydrationTags !== undefined) attributes.rehydrationTags = rehydrationTags
  if (rehydrationMaxScanSizeInGb !== undefined) {
    attributes.rehydrationMaxScanSizeInGb = rehydrationMaxScanSizeInGb
  }

  return {
    data: {
      type: 'archives',
      attributes
    }
  } as unknown as v2.LogsArchiveCreateRequest
}

export async function listArchives(api: v2.LogsArchivesApi, verbose: boolean = false) {
  const response = await api.listLogsArchives()
  const archives = (response.data ?? []).map((archive) => formatArchive(archive, verbose))
  const result: Record<string, unknown> = { archives, total: archives.length }
  if (verbose) {
    result.raw = response
  }
  return result
}

export async function getArchive(api: v2.LogsArchivesApi, id: string, verbose: boolean = false) {
  const response = await api.getLogsArchive({ archiveId: id })
  const archive = response.data
  if (!archive) {
    throw new Error(`Archive ${id} returned an empty payload`)
  }
  const result: Record<string, unknown> = { archive: formatArchive(archive, verbose) }
  if (verbose) {
    result.raw = response
  }
  return result
}

export async function createArchive(
  api: v2.LogsArchivesApi,
  config: Record<string, unknown>,
  verbose: boolean = false
) {
  const normalized = normalizeArchiveConfig(config)
  const body = buildArchiveRequestBody(normalized)
  const response = await api.createLogsArchive({ body })
  const archive = response.data
  if (!archive) {
    throw new Error('Archive creation returned an empty payload')
  }
  const result: Record<string, unknown> = {
    success: true,
    archive: formatArchive(archive, verbose)
  }
  if (verbose) {
    result.raw = response
  }
  return result
}

export async function updateArchive(
  api: v2.LogsArchivesApi,
  id: string,
  config: Record<string, unknown>,
  verbose: boolean = false
) {
  const normalized = normalizeArchiveConfig(config)
  const body = buildArchiveRequestBody(normalized)
  const response = await api.updateLogsArchive({ archiveId: id, body })
  const archive = response.data
  if (!archive) {
    throw new Error(`Archive ${id} update returned an empty payload`)
  }
  const result: Record<string, unknown> = {
    success: true,
    archive: formatArchive(archive, verbose)
  }
  if (verbose) {
    result.raw = response
  }
  return result
}

export async function deleteArchive(api: v2.LogsArchivesApi, id: string) {
  await api.deleteLogsArchive({ archiveId: id })
  return {
    success: true,
    message: `Archive ${id} deleted`
  }
}

export async function reorderArchives(api: v2.LogsArchivesApi, archiveIds: string[]) {
  const body = {
    data: {
      type: 'archive_order',
      attributes: {
        archiveIds
      }
    }
  } as unknown as v2.LogsArchiveOrder
  const response = await api.updateLogsArchiveOrder({ body })
  const resultIds =
    (response.data?.attributes as { archiveIds?: string[] } | undefined)?.archiveIds ?? []
  return {
    success: true,
    order: {
      archiveIds: resultIds
    }
  }
}

export async function getArchiveOrder(api: v2.LogsArchivesApi) {
  const response = await api.getLogsArchiveOrder()
  const resultIds =
    (response.data?.attributes as { archiveIds?: string[] } | undefined)?.archiveIds ?? []
  return {
    order: {
      archiveIds: resultIds
    }
  }
}

export function registerLogsArchivesTool(
  server: McpServer,
  api: v2.LogsArchivesApi,
  _limits: LimitsConfig,
  readOnly: boolean = false,
  _site: string = 'datadoghq.com'
): void {
  server.tool(
    'logs_archives',
    "Manage Datadog Logs archives (long-term log retention to S3 / GCS / Azure Blob). Actions: list, get, create, update, delete, reorder, get_order. Archives accept destinations of type 's3', 'gcs', or 'azure_storage'; per-provider credential and integration fields (S3 IAM role ARN, GCS service account, Azure tenant/secret) are forwarded unchanged. Mutations (create, update, delete, reorder) are blocked when the server is in read-only mode.",
    InputSchema,
    async ({ action, id, config, archive_ids, verbose }) => {
      try {
        checkReadOnly(action, readOnly)
        const isVerbose = verbose ?? false
        switch (action) {
          case 'list':
            return toolResult(await listArchives(api, isVerbose))

          case 'get': {
            const archiveId = requireParam(id, 'id', 'get')
            return toolResult(await getArchive(api, archiveId, isVerbose))
          }

          case 'create': {
            const archiveConfig = requireParam(config, 'config', 'create')
            return toolResult(await createArchive(api, archiveConfig, isVerbose))
          }

          case 'update': {
            const archiveId = requireParam(id, 'id', 'update')
            const archiveConfig = requireParam(config, 'config', 'update')
            return toolResult(await updateArchive(api, archiveId, archiveConfig, isVerbose))
          }

          case 'delete': {
            const archiveId = requireParam(id, 'id', 'delete')
            return toolResult(await deleteArchive(api, archiveId))
          }

          case 'reorder': {
            const ids = requireParam(archive_ids, 'archive_ids', 'reorder')
            return toolResult(await reorderArchives(api, ids))
          }

          case 'get_order':
            return toolResult(await getArchiveOrder(api))

          default:
            throw new Error(`Unknown action: ${String(action)}`)
        }
      } catch (error) {
        handleDatadogError(error)
      }
    }
  )
}
