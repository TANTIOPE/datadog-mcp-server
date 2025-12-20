import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v2 } from '@datadog/datadog-api-client'
import { handleDatadogError } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import { hoursAgo, now, parseTime, ensureValidTimeRange } from '../utils/time.js'
import { buildLogsUrl } from '../utils/urls.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['search', 'aggregate'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  query: z
    .string()
    .optional()
    .describe(
      'Log search query (Datadog syntax). Examples: "error", "service:my-service status:error", "error AND timeout"'
    ),
  keyword: z
    .string()
    .optional()
    .describe(
      'Simple text search - finds logs containing this text (grep-like). Merged with query using AND'
    ),
  pattern: z
    .string()
    .optional()
    .describe(
      'Regex pattern to match in log message (grep -E style). Example: "ERROR.*timeout|connection refused"'
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
    .describe('End time. Same formats as "from". Example: from="3d@11:45:23" to="3d@12:55:34"'),
  service: z.string().optional().describe('Filter by service name'),
  host: z.string().optional().describe('Filter by host'),
  status: z
    .enum(['error', 'warn', 'info', 'debug'])
    .optional()
    .describe('Filter by log status/level'),
  indexes: z.array(z.string()).optional().describe('Log indexes to search'),
  limit: z.number().optional().describe('Maximum number of logs to return'),
  sort: z.enum(['timestamp', '-timestamp']).optional().describe('Sort order'),
  sample: z
    .enum(['first', 'spread', 'diverse'])
    .optional()
    .describe(
      'Sampling mode: first (chronological, default), spread (evenly across time range), diverse (distinct message patterns)'
    ),
  compact: z
    .boolean()
    .optional()
    .describe(
      'Strip custom attributes for token efficiency. Keeps: id, timestamp, service, host, status, message (truncated), dd.trace_id, dd.span_id, pod_name, kube_namespace, kube_container_name, error info'
    ),
  groupBy: z.array(z.string()).optional().describe('Fields to group by (for aggregate)'),
  compute: z.record(z.unknown()).optional().describe('Compute operations (for aggregate)')
}

interface LogEntry {
  id: string
  timestamp: string
  service: string
  host: string
  status: string
  message: string
  tags: string[]
  attributes: Record<string, unknown>
}

export function formatLog(log: v2.Log): LogEntry {
  const attrs = log.attributes ?? {}
  // Handle timestamp which can be Date or string
  let timestamp = ''
  if (attrs.timestamp) {
    const ts = attrs.timestamp
    timestamp = ts instanceof Date ? ts.toISOString() : new Date(String(ts)).toISOString()
  }
  return {
    id: log.id ?? '',
    timestamp,
    service: (attrs.service as string) ?? '',
    host: (attrs.host as string) ?? '',
    status: (attrs.status as string) ?? '',
    message: (attrs.message as string) ?? '',
    tags: (attrs.tags as string[]) ?? [],
    attributes: (attrs.attributes as Record<string, unknown>) ?? {}
  }
}

/**
 * Compact log format for token efficiency
 * Strips custom attributes object, keeps only essential fields for investigation
 */
interface CompactLogEntry {
  id: string
  timestamp: string
  service: string
  host: string
  status: string
  message: string // truncated to 500 chars
  traceId: string // extracted from dd.trace_id for correlation
  spanId: string
  podName?: string // extracted from pod_name tag
  namespace?: string // extracted from kube_namespace tag
  container?: string // extracted from kube_container_name tag
  error?: {
    type: string
    message: string
  }
}

type FormattedLog = LogEntry | CompactLogEntry

export function formatLogCompact(log: v2.Log): CompactLogEntry {
  const attrs = log.attributes ?? {}
  const nestedAttrs = (attrs.attributes as Record<string, unknown>) ?? {}
  const tags = (attrs.tags as string[]) ?? []

  // Parse Kubernetes fields from tags (format: "key:value")
  const findTagValue = (tagPrefix: string): string => {
    const tag = tags.find((t) => t.startsWith(tagPrefix + ':'))
    return tag ? tag.substring(tagPrefix.length + 1) : ''
  }

  const podName = findTagValue('pod_name')
  const namespace = findTagValue('kube_namespace')
  const container = findTagValue('kube_container_name')

  // Handle timestamp
  let timestamp = ''
  if (attrs.timestamp) {
    const ts = attrs.timestamp
    timestamp = ts instanceof Date ? ts.toISOString() : new Date(String(ts)).toISOString()
  }

  // Extract trace correlation IDs from various possible locations
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attrsAny = attrs as any
  const traceId =
    (nestedAttrs['dd.trace_id'] as string) ??
    (nestedAttrs['trace_id'] as string) ??
    (attrsAny['dd.trace_id'] as string) ??
    ''
  const spanId =
    (nestedAttrs['dd.span_id'] as string) ??
    (nestedAttrs['span_id'] as string) ??
    (attrsAny['dd.span_id'] as string) ??
    ''

  // Extract error info
  const errorType =
    (nestedAttrs['error.type'] as string) ?? (nestedAttrs['error.kind'] as string) ?? ''
  const errorMessage =
    (nestedAttrs['error.message'] as string) ?? (nestedAttrs['error.msg'] as string) ?? ''

  // Truncate message for token efficiency
  const fullMessage = (attrs.message as string) ?? ''
  const message = fullMessage.length > 500 ? fullMessage.slice(0, 500) + '...' : fullMessage

  const entry: CompactLogEntry = {
    id: log.id ?? '',
    timestamp,
    service: (attrs.service as string) ?? '',
    host: (attrs.host as string) ?? '',
    status: (attrs.status as string) ?? '',
    message,
    traceId,
    spanId
  }

  // Add Kubernetes fields if present
  if (podName) entry.podName = podName
  if (namespace) entry.namespace = namespace
  if (container) entry.container = container

  // Only include error if present
  if (errorType || errorMessage) {
    entry.error = {
      type: errorType,
      message: errorMessage.length > 200 ? errorMessage.slice(0, 200) + '...' : errorMessage
    }
  }

  return entry
}

/**
 * Normalize a log message to a pattern by replacing variable parts
 * Used for diverse sampling to identify distinct error patterns
 */
export function normalizeToPattern(message: string): string {
  return (
    message
      // UUIDs (universal format)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{UUID}')
      // Long hex strings (16+ chars - trace IDs, hashes, object IDs)
      .replace(/\b[0-9a-f]{16,}\b/gi, '{HEX}')
      // Shorter hex IDs (8-15 chars)
      .replace(/\b[0-9a-f]{8,15}\b/gi, '{ID}')
      // ISO timestamps
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\dZ]*/g, '{TS}')
      // IP addresses
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '{IP}')
      // Large numbers (4+ digits) - after other patterns to avoid breaking them
      .replace(/\b\d{4,}\b/g, '{N}')
      // Truncate for efficient hashing
      .slice(0, 200)
  )
}

/**
 * Spread sample: evenly distributed across the array
 */
export function spreadSample<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items
  const step = items.length / limit
  return Array.from({ length: limit }, (_, i) => items[Math.floor(i * step)] as T)
}

/**
 * Diverse sample: deduplicate by message pattern to get distinct error types
 */
export function diverseSample<T extends { message: string }>(
  items: T[],
  limit: number
): { samples: T[]; patterns: number } {
  const seen = new Map<string, T>()

  for (const item of items) {
    const pattern = normalizeToPattern(item.message)
    if (!seen.has(pattern)) {
      seen.set(pattern, item)
      if (seen.size >= limit) break
    }
  }

  return {
    samples: Array.from(seen.values()),
    patterns: seen.size
  }
}

/**
 * Build a Datadog log query from various filter parameters
 */
export function buildLogQuery(params: {
  query?: string
  keyword?: string
  pattern?: string
  service?: string
  host?: string
  status?: string
}): string {
  const parts: string[] = []

  // Base query or wildcard
  if (params.query) {
    parts.push(params.query)
  }

  // Simple keyword search (grep-like)
  if (params.keyword) {
    // Escape special characters and wrap in quotes for exact phrase
    const escaped = params.keyword.replace(/"/g, '\\"')
    parts.push(`"${escaped}"`)
  }

  // Regex pattern search on message field
  if (params.pattern) {
    // Datadog regex syntax: @field:~"pattern"
    const escaped = params.pattern.replace(/"/g, '\\"')
    parts.push(`@message:~"${escaped}"`)
  }

  // Service filter
  if (params.service) {
    parts.push(`service:${params.service}`)
  }

  // Host filter
  if (params.host) {
    parts.push(`host:${params.host}`)
  }

  // Status filter
  if (params.status) {
    parts.push(`status:${params.status}`)
  }

  // If no parts, search everything
  return parts.length > 0 ? parts.join(' ') : '*'
}

export async function searchLogs(
  api: v2.LogsApi,
  params: {
    query?: string
    keyword?: string
    pattern?: string
    service?: string
    host?: string
    status?: string
    from?: string
    to?: string
    indexes?: string[]
    limit?: number
    sort?: 'timestamp' | '-timestamp'
    sample?: 'first' | 'spread' | 'diverse'
    compact?: boolean
  },
  limits: LimitsConfig,
  site: string
) {
  const defaultFrom = hoursAgo(limits.defaultTimeRangeHours)
  const defaultTo = now()

  // Parse and validate time range (ensures from < to)
  const [validFrom, validTo] = ensureValidTimeRange(
    parseTime(params.from, defaultFrom),
    parseTime(params.to, defaultTo)
  )
  const fromTime = new Date(validFrom * 1000).toISOString()
  const toTime = new Date(validTo * 1000).toISOString()

  // Build the full query from all filter params
  const fullQuery = buildLogQuery({
    query: params.query,
    keyword: params.keyword,
    pattern: params.pattern,
    service: params.service,
    host: params.host,
    status: params.status
  })

  const requestedLimit = params.limit ?? limits.defaultLimit
  const sampleMode = params.sample ?? 'first'

  // For spread/diverse sampling, fetch more logs to sample from
  const fetchMultiplier = sampleMode === 'first' ? 1 : 4
  const fetchLimit = Math.min(requestedLimit * fetchMultiplier, limits.maxLogLines)

  const body: v2.LogsListRequest = {
    filter: {
      query: fullQuery,
      from: fromTime,
      to: toTime,
      indexes: params.indexes
    },
    sort: params.sort === 'timestamp' ? 'timestamp' : '-timestamp',
    page: {
      limit: fetchLimit
    }
  }

  const response = await api.listLogs({ body })

  // Format logs (compact or full)
  const formattedLogs = params.compact
    ? (response.data ?? []).map(formatLogCompact)
    : (response.data ?? []).map(formatLog)

  // Apply sampling based on mode
  // Type assertion needed because ternary produces CompactLogEntry[] | LogEntry[]
  // but generic functions need (CompactLogEntry | LogEntry)[]
  let logs: FormattedLog[]
  let distinctPatterns: number | undefined

  switch (sampleMode) {
    case 'spread':
      logs = spreadSample(formattedLogs as FormattedLog[], requestedLimit)
      break
    case 'diverse': {
      const result = diverseSample(formattedLogs as FormattedLog[], requestedLimit)
      logs = result.samples
      distinctPatterns = result.patterns
      break
    }
    case 'first':
    default:
      logs = formattedLogs.slice(0, requestedLimit)
  }

  return {
    logs,
    meta: {
      count: logs.length,
      query: fullQuery,
      from: fromTime,
      to: toTime,
      compact: params.compact ?? false,
      sample: sampleMode,
      ...(sampleMode !== 'first' && { fetched: formattedLogs.length }),
      ...(distinctPatterns !== undefined && { distinctPatterns }),
      datadog_url: buildLogsUrl(fullQuery, validFrom, validTo, site)
    }
  }
}

export async function aggregateLogs(
  api: v2.LogsApi,
  params: {
    query: string
    from?: string
    to?: string
    groupBy?: string[]
    compute?: Record<string, unknown>
  },
  limits: LimitsConfig,
  site: string
) {
  const defaultFrom = hoursAgo(limits.defaultTimeRangeHours)
  const defaultTo = now()

  // Parse and validate time range (ensures from < to)
  const [validFrom, validTo] = ensureValidTimeRange(
    parseTime(params.from, defaultFrom),
    parseTime(params.to, defaultTo)
  )
  const fromTime = new Date(validFrom * 1000).toISOString()
  const toTime = new Date(validTo * 1000).toISOString()

  const computeOps: v2.LogsCompute[] = params.compute
    ? [params.compute as unknown as v2.LogsCompute]
    : [{ aggregation: 'count' as const, type: 'total' as const }]

  const body: v2.LogsAggregateRequest = {
    filter: {
      query: params.query,
      from: fromTime,
      to: toTime
    },
    compute: computeOps,
    groupBy: params.groupBy?.map((field) => ({
      facet: field,
      limit: 10
    }))
  }

  const response = await api.aggregateLogs({ body })

  return {
    buckets: response.data?.buckets ?? [],
    meta: {
      query: params.query,
      from: fromTime,
      to: toTime,
      groupBy: params.groupBy,
      datadog_url: buildLogsUrl(params.query, validFrom, validTo, site)
    }
  }
}

export function registerLogsTool(
  server: McpServer,
  api: v2.LogsApi,
  limits: LimitsConfig,
  site: string = 'datadoghq.com'
): void {
  server.tool(
    'logs',
    `Search Datadog logs with grep-like text filtering. Actions: search (find logs), aggregate (count/group). Key filters: keyword (text grep), pattern (regex), service, host, status (error/warn/info). Time ranges: "1h", "3d@11:45:23".
CORRELATION: Logs contain dd.trace_id in attributes for linking to traces and APM metrics.
SAMPLING: Use sample:"diverse" for error investigation (dedupes by message pattern), sample:"spread" for time distribution.
TOKEN TIP: Use compact:true to reduce payload size (strips heavy fields) when querying large volumes.`,
    InputSchema,
    async ({
      action,
      query,
      keyword,
      pattern,
      service,
      host,
      status,
      from,
      to,
      indexes,
      limit,
      sort,
      sample,
      compact,
      groupBy,
      compute
    }) => {
      try {
        switch (action) {
          case 'search': {
            // Query is now optional - can use keyword, pattern, or filters instead
            return toolResult(
              await searchLogs(
                api,
                {
                  query,
                  keyword,
                  pattern,
                  service,
                  host,
                  status,
                  from,
                  to,
                  indexes,
                  limit,
                  sort,
                  sample,
                  compact
                },
                limits,
                site
              )
            )
          }

          case 'aggregate': {
            const aggregateQuery = query ?? '*'
            return toolResult(
              await aggregateLogs(
                api,
                {
                  query: aggregateQuery,
                  from,
                  to,
                  groupBy,
                  compute
                },
                limits,
                site
              )
            )
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
