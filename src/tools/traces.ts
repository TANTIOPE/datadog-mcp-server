import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v2 } from '@datadog/datadog-api-client'
import { handleDatadogError } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import {
  hoursAgo,
  now,
  parseTime,
  ensureValidTimeRange,
  parseDurationToNs,
  formatDurationNs
} from '../utils/time.js'
import { buildTracesUrl } from '../utils/urls.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['search', 'aggregate', 'services'])

// Reserved span facets that should NOT be prefixed with @
const RESERVED_SPAN_FACETS = new Set([
  'service',
  'resource_name',
  'operation_name',
  'span_name',
  'status',
  'env',
  'host',
  'type',
  'duration',
  'trace_id',
  'span_id'
])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  query: z
    .string()
    .optional()
    .describe(
      'APM trace search query (Datadog syntax). Example: "@http.status_code:500", "service:my-service status:error"'
    ),
  from: z
    .string()
    .optional()
    .describe(
      'Start time. Formats: ISO 8601, relative (30s, 15m, 2h, 7d), precise (3d@11:45:23, yesterday@14:00)'
    ),
  to: z
    .string()
    .optional()
    .describe('End time. Same formats as "from". Example: from="3d@11:45" to="3d@12:55"'),
  service: z
    .string()
    .optional()
    .describe('Filter by service name. Example: "my-service", "postgres"'),
  operation: z
    .string()
    .optional()
    .describe('Filter by operation name. Example: "express.request", "mongodb.query"'),
  resource: z
    .string()
    .optional()
    .describe(
      'Filter by resource name (endpoint/query). Supports wildcards. Example: "GET /api/*", "*orders*"'
    ),
  status: z
    .enum(['ok', 'error'])
    .optional()
    .describe('Filter by span status - "ok" for successful, "error" for failed spans'),
  env: z.string().optional().describe('Filter by environment. Example: "production", "staging"'),
  minDuration: z
    .string()
    .optional()
    .describe('Minimum span duration (find slow spans). Examples: "1s", "500ms", "100ms"'),
  maxDuration: z.string().optional().describe('Maximum span duration. Examples: "5s", "1000ms"'),
  httpStatus: z
    .string()
    .optional()
    .describe(
      'HTTP status code filter. Examples: "500", "5xx" (500-599), "4xx" (400-499), ">=400"'
    ),
  errorType: z
    .string()
    .optional()
    .describe('Filter by error type (grep-like). Example: "TimeoutError", "ConnectionRefused"'),
  errorMessage: z
    .string()
    .optional()
    .describe('Filter by error message (grep-like). Example: "timeout", "connection refused"'),
  limit: z.number().min(1).optional().describe('Maximum number of results (default: 50)'),
  sort: z.enum(['timestamp', '-timestamp']).optional().describe('Sort order'),
  groupBy: z
    .array(z.string())
    .optional()
    .describe('Fields to group by (for aggregate). Example: ["resource_name", "status"]')
}

interface SpanSummary {
  traceId: string
  spanId: string
  service: string
  resource: string
  operation: string
  type: string
  status: string
  duration: string
  durationNs: number
  http: {
    statusCode: string
    method: string
    url: string
  }
  error: {
    type: string
    message: string
  }
  env: string
  tags: string[]
}

// SDK types are incomplete - extend with actual API response fields
interface SpanAttributesExtended {
  tags?: string[]
  attributes?: Record<string, unknown>
  custom?: {
    error?: Record<string, unknown>
    [key: string]: unknown
  }
  error?: Record<string, unknown>
  status?: string
  operationName?: string
  startTimestamp?: Date
  endTimestamp?: Date
  traceId?: string
  spanId?: string
  service?: string
  resourceName?: string
  type?: string
  env?: string
  [key: string]: unknown
}

export function formatSpan(span: v2.Span): SpanSummary {
  // SDK types are incomplete - actual API returns more fields than typed
  // Using SpanAttributesExtended to access real API fields: error, status, operationName
  const attrs = (span.attributes ?? {}) as SpanAttributesExtended
  const tags = (attrs.tags as string[]) ?? []
  const nestedAttrs = (attrs.attributes ?? {}) as Record<string, unknown>
  const custom = (attrs.custom ?? {}) as Record<string, unknown>
  const attrsError = (attrs.error ?? {}) as Record<string, unknown>
  const customError = (custom.error ?? {}) as Record<string, unknown>

  // Extract common tags into a map
  const tagMap: Record<string, string> = {}
  for (const tag of tags) {
    const [key, value] = tag.split(':')
    if (key && value) tagMap[key] = value
  }

  // Calculate duration from timestamps or get from nested attributes
  let durationNs = 0
  if (attrs.startTimestamp && attrs.endTimestamp) {
    const startMs = attrs.startTimestamp.getTime()
    const endMs = attrs.endTimestamp.getTime()
    durationNs = (endMs - startMs) * 1_000_000 // ms to ns
  } else if (typeof nestedAttrs['duration'] === 'number') {
    durationNs = nestedAttrs['duration']
  } else if (typeof custom['duration'] === 'number') {
    durationNs = custom['duration']
  }

  // Get status - prioritize direct attrs field, then custom, then tags
  const status = (attrs.status as string) ?? (custom['status'] as string) ?? tagMap['status'] ?? ''

  return {
    traceId: attrs.traceId ?? '',
    spanId: attrs.spanId ?? '',
    service: attrs.service ?? '',
    resource: attrs.resourceName ?? '',
    operation: (attrs.operationName as string) ?? (custom['operation_name'] as string) ?? '',
    type: attrs.type ?? '',
    status,
    duration: formatDurationNs(durationNs),
    durationNs,
    http: {
      statusCode: tagMap['http.status_code'] ?? '',
      method: tagMap['http.method'] ?? '',
      url: tagMap['http.url'] ?? ''
    },
    error: {
      type:
        (attrsError['type'] as string) ??
        (customError['type'] as string) ??
        tagMap['error.type'] ??
        '',
      message:
        (customError['message'] as string) ?? tagMap['error.message'] ?? tagMap['error.msg'] ?? ''
    },
    env: attrs.env ?? tagMap['env'] ?? '',
    tags
  }
}

/**
 * Build HTTP status code filter string for trace query
 * Handles ranges (5xx), comparisons (>=500), and exact values (404)
 */
function buildHttpStatusFilter(httpStatus: string): string {
  const status = httpStatus.toLowerCase()

  if (status.endsWith('xx')) {
    const base = Number.parseInt(status[0] ?? '0', 10) * 100
    return `@http.status_code:[${base} TO ${base + 99}]`
  }
  if (status.startsWith('>=')) return `@http.status_code:>=${status.slice(2)}`
  if (status.startsWith('>')) return `@http.status_code:>${status.slice(1)}`
  if (status.startsWith('<=')) return `@http.status_code:<=${status.slice(2)}`
  if (status.startsWith('<')) return `@http.status_code:<${status.slice(1)}`

  return `@http.status_code:${httpStatus}`
}

/**
 * Build a Datadog APM trace query from filter parameters
 */
export function buildTraceQuery(params: {
  query?: string
  service?: string
  operation?: string
  resource?: string
  status?: 'ok' | 'error'
  env?: string
  minDuration?: string
  maxDuration?: string
  httpStatus?: string
  errorType?: string
  errorMessage?: string
}): string {
  const parts: string[] = []

  // Base query
  if (params.query) {
    parts.push(params.query)
  }

  // Service filter
  if (params.service) {
    parts.push(`service:${params.service}`)
  }

  // Operation name filter
  if (params.operation) {
    parts.push(`operation_name:${params.operation}`)
  }

  // Resource name filter (endpoint/query name)
  if (params.resource) {
    parts.push(`resource_name:${params.resource}`)
  }

  // Span status filter (ok/error)
  if (params.status) {
    parts.push(`status:${params.status}`)
  }

  // Environment filter
  if (params.env) {
    parts.push(`env:${params.env}`)
  }

  // Duration filters (convert to nanoseconds)
  if (params.minDuration) {
    const ns = parseDurationToNs(params.minDuration)
    if (ns !== undefined) {
      parts.push(`@duration:>=${ns}`)
    }
  }
  if (params.maxDuration) {
    const ns = parseDurationToNs(params.maxDuration)
    if (ns !== undefined) {
      parts.push(`@duration:<=${ns}`)
    }
  }

  // HTTP status code filter
  if (params.httpStatus) {
    parts.push(buildHttpStatusFilter(params.httpStatus))
  }

  // Error type grep (wildcard search)
  if (params.errorType) {
    const escaped = params.errorType.replace(/"/g, '\\"')
    parts.push(`error.type:*${escaped}*`)
  }

  // Error message grep (wildcard search)
  if (params.errorMessage) {
    const escaped = params.errorMessage.replace(/"/g, '\\"')
    parts.push(`error.message:*${escaped}*`)
  }

  return parts.length > 0 ? parts.join(' ') : '*'
}

export async function searchTraces(
  api: v2.SpansApi,
  params: {
    query?: string
    from?: string
    to?: string
    service?: string
    operation?: string
    resource?: string
    status?: 'ok' | 'error'
    env?: string
    minDuration?: string
    maxDuration?: string
    httpStatus?: string
    errorType?: string
    errorMessage?: string
    limit?: number
    sort?: string
  },
  limits: LimitsConfig,
  site: string
) {
  const defaultFrom = hoursAgo(limits.defaultTimeRangeHours)
  const defaultTo = now()

  // Build query from all filter params
  const fullQuery = buildTraceQuery({
    query: params.query,
    service: params.service,
    operation: params.operation,
    resource: params.resource,
    status: params.status,
    env: params.env,
    minDuration: params.minDuration,
    maxDuration: params.maxDuration,
    httpStatus: params.httpStatus,
    errorType: params.errorType,
    errorMessage: params.errorMessage
  })

  // Parse and validate time range (ensures from < to)
  const [validFrom, validTo] = ensureValidTimeRange(
    parseTime(params.from, defaultFrom),
    parseTime(params.to, defaultTo)
  )
  const fromTime = new Date(validFrom * 1000).toISOString()
  const toTime = new Date(validTo * 1000).toISOString()

  const body: v2.SpansListRequest = {
    data: {
      type: 'search_request',
      attributes: {
        filter: {
          query: fullQuery,
          from: fromTime,
          to: toTime
        },
        sort: params.sort === 'timestamp' ? 'timestamp' : '-timestamp',
        page: {
          limit: params.limit ?? limits.defaultLimit
        }
      }
    }
  }

  const response = await api.listSpans({ body })
  const spans = (response.data ?? []).map(formatSpan)

  return {
    spans,
    meta: {
      count: spans.length,
      query: fullQuery,
      from: fromTime,
      to: toTime,
      datadog_url: buildTracesUrl(fullQuery, validFrom, validTo, site)
    }
  }
}

export async function aggregateTraces(
  api: v2.SpansApi,
  params: {
    query?: string
    from?: string
    to?: string
    service?: string
    operation?: string
    resource?: string
    status?: 'ok' | 'error'
    env?: string
    minDuration?: string
    maxDuration?: string
    httpStatus?: string
    errorType?: string
    errorMessage?: string
    groupBy?: string[]
  },
  limits: LimitsConfig,
  site: string
) {
  const defaultFrom = hoursAgo(limits.defaultTimeRangeHours)
  const defaultTo = now()

  // Build query from all filter params
  const fullQuery = buildTraceQuery({
    query: params.query,
    service: params.service,
    operation: params.operation,
    resource: params.resource,
    status: params.status,
    env: params.env,
    minDuration: params.minDuration,
    maxDuration: params.maxDuration,
    httpStatus: params.httpStatus,
    errorType: params.errorType,
    errorMessage: params.errorMessage
  })

  // Parse and validate time range (ensures from < to)
  const [validFrom, validTo] = ensureValidTimeRange(
    parseTime(params.from, defaultFrom),
    parseTime(params.to, defaultTo)
  )
  const fromTime = new Date(validFrom * 1000).toISOString()
  const toTime = new Date(validTo * 1000).toISOString()

  // Use raw object structure to avoid TypeScript SDK type issues
  // Note: sort is omitted from group_by as it causes API validation errors
  const body = {
    data: {
      type: 'aggregate_request',
      attributes: {
        filter: {
          query: fullQuery,
          from: fromTime,
          to: toTime
        },
        compute: [{ aggregation: 'count', type: 'total' }],
        groupBy: params.groupBy?.map((field) => ({
          facet: RESERVED_SPAN_FACETS.has(field) || field.startsWith('@') ? field : `@${field}`,
          limit: 10
        }))
      }
    }
  } as v2.SpansAggregateRequest

  const response = await api.aggregateSpans({ body })

  return {
    data: response.data ?? [],
    meta: {
      query: fullQuery,
      from: fromTime,
      to: toTime,
      groupBy: params.groupBy,
      datadog_url: buildTracesUrl(fullQuery, validFrom, validTo, site)
    }
  }
}

export async function listApmServices(
  api: v2.SpansApi,
  params: { env?: string; from?: string; to?: string },
  limits: LimitsConfig
) {
  const defaultFrom = hoursAgo(24) // Look back 24 hours for services
  const defaultTo = now()

  // Parse and validate time range
  const [validFrom, validTo] = ensureValidTimeRange(
    parseTime(params.from, defaultFrom),
    parseTime(params.to, defaultTo)
  )
  const fromTime = new Date(validFrom * 1000).toISOString()
  const toTime = new Date(validTo * 1000).toISOString()

  // Build query - env filter is optional
  const query = params.env ? `env:${params.env}` : '*'

  // Aggregate spans by service name to discover APM services
  // Use raw object structure to avoid TypeScript SDK type issues
  // Note: sort is omitted as it causes API validation errors
  const body = {
    data: {
      type: 'aggregate_request',
      attributes: {
        filter: {
          query,
          from: fromTime,
          to: toTime
        },
        compute: [{ aggregation: 'count', type: 'total' }],
        groupBy: [
          {
            facet: 'service',
            limit: limits.defaultLimit
          }
        ]
      }
    }
  } as v2.SpansAggregateRequest

  const response = await api.aggregateSpans({ body })

  // Extract service names from aggregation buckets
  // SDK types define 'computes' but API returns 'compute' (singular)
  const buckets = (response.data ?? []) as Array<{
    attributes?: {
      by?: Record<string, string>
      compute?: Record<string, number>
    }
  }>

  const services = buckets
    .map((bucket) => ({
      name: bucket.attributes?.by?.['service'] ?? '',
      spanCount: bucket.attributes?.compute?.['c0'] ?? 0
    }))
    .filter((s) => s.name !== '')

  return {
    services,
    total: services.length,
    meta: {
      query,
      env: params.env ?? 'all',
      from: fromTime,
      to: toTime
    }
  }
}

export function registerTracesTool(
  server: McpServer,
  spansApi: v2.SpansApi,
  _servicesApi: v2.ServiceDefinitionApi, // Keep for backward compatibility, not used
  limits: LimitsConfig,
  site: string = 'datadoghq.com'
): void {
  server.tool(
    'traces',
    `Analyze APM traces for request flow and latency debugging. Actions: search (find spans), aggregate (group stats), services (list APM services). Key filters: minDuration/maxDuration ("500ms", "2s"), httpStatus ("5xx", ">=400"), status (ok/error), errorMessage (grep).
APM METRICS: Traces auto-generate metrics in trace.{service}.* namespace. Use metrics tool to query: avg:trace.{service}.request.duration{*}`,
    InputSchema,
    async ({
      action,
      query,
      from,
      to,
      service,
      operation,
      resource,
      status,
      env,
      minDuration,
      maxDuration,
      httpStatus,
      errorType,
      errorMessage,
      limit,
      sort,
      groupBy
    }) => {
      try {
        switch (action) {
          case 'search': {
            return toolResult(
              await searchTraces(
                spansApi,
                {
                  query,
                  from,
                  to,
                  service,
                  operation,
                  resource,
                  status,
                  env,
                  minDuration,
                  maxDuration,
                  httpStatus,
                  errorType,
                  errorMessage,
                  limit,
                  sort
                },
                limits,
                site
              )
            )
          }

          case 'aggregate': {
            return toolResult(
              await aggregateTraces(
                spansApi,
                {
                  query,
                  from,
                  to,
                  service,
                  operation,
                  resource,
                  status,
                  env,
                  minDuration,
                  maxDuration,
                  httpStatus,
                  errorType,
                  errorMessage,
                  groupBy
                },
                limits,
                site
              )
            )
          }

          case 'services':
            return toolResult(await listApmServices(spansApi, { env, from, to }, limits))

          default:
            throw new Error(`Unknown action: ${action}`)
        }
      } catch (error) {
        handleDatadogError(error)
      }
    }
  )
}
