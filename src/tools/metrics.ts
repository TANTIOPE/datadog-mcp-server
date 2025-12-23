import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1, v2 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import { hoursAgo, now, parseTime, ensureValidTimeRange } from '../utils/time.js'
import { buildMetricsUrl } from '../utils/urls.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['query', 'search', 'list', 'metadata'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  query: z
    .string()
    .optional()
    .describe(
      'For query: PromQL expression (e.g., "avg:system.cpu.user{*}"). For search: grep-like filter on metric names. For list: tag filter.'
    ),
  from: z
    .string()
    .optional()
    .describe(
      'Start time (ONLY for query action). Formats: ISO 8601, relative (30s, 15m, 2h, 7d), precise (3d@11:45:23)'
    ),
  to: z.string().optional().describe('End time (ONLY for query action). Same formats as "from".'),
  metric: z.string().optional().describe('Metric name (for metadata action)'),
  tag: z.string().optional().describe('Filter by tag'),
  limit: z
    .number()
    .min(1)
    .optional()
    .describe('Maximum number of results (for search/list, default: 50)'),
  pointLimit: z
    .number()
    .min(1)
    .optional()
    .describe(
      'Maximum data points per timeseries (for query action). AI controls resolution vs token usage (default: 1000).'
    )
}

interface MetricSeriesData {
  metric: string
  points: Array<{ timestamp: number; value: number }>
  scope: string
  tags: string[]
}

export async function queryMetrics(
  api: v1.MetricsApi,
  params: {
    query: string
    from?: string
    to?: string
    pointLimit?: number
  },
  limits: LimitsConfig,
  site: string
) {
  const defaultFrom = hoursAgo(limits.defaultTimeRangeHours)
  const defaultTo = now()

  // Parse and validate time range (ensures from < to)
  const [fromTs, toTs] = ensureValidTimeRange(
    parseTime(params.from, defaultFrom),
    parseTime(params.to, defaultTo)
  )

  const response = await api.queryMetrics({
    from: fromTs,
    to: toTs,
    query: params.query
  })

  const series: MetricSeriesData[] = (response.series ?? []).map((s) => ({
    metric: s.metric ?? '',
    points: (s.pointlist ?? [])
      .slice(0, params.pointLimit ?? limits.defaultMetricDataPoints)
      .map((p) => ({
        timestamp: p[0] ?? 0,
        value: p[1] ?? 0
      })),
    scope: s.scope ?? '',
    tags: s.tagSet ?? []
  }))

  return {
    series,
    meta: {
      query: params.query,
      from: new Date(fromTs * 1000).toISOString(),
      to: new Date(toTs * 1000).toISOString(),
      seriesCount: series.length,
      datadog_url: buildMetricsUrl(params.query, fromTs, toTs, site)
    }
  }
}

export async function searchMetrics(
  api: v1.MetricsApi,
  params: { query: string; limit?: number },
  limits: LimitsConfig
) {
  // Use listActiveMetrics with 24h window (same as list), then filter by name
  const response = await api.listActiveMetrics({
    from: hoursAgo(24),
    host: undefined,
    tagFilter: undefined // Must match listMetrics exactly
  })

  const allMetrics = response.metrics ?? []
  const lowerQuery = params.query.toLowerCase()

  // Filter by query (grep-like on metric name)
  const filtered = allMetrics
    .filter((name) => name.toLowerCase().includes(lowerQuery))
    .slice(0, params.limit ?? limits.defaultLimit)

  return {
    metrics: filtered,
    total: filtered.length,
    searchedFrom: allMetrics.length
  }
}

export async function listMetrics(
  api: v1.MetricsApi,
  params: { query?: string },
  _limits: LimitsConfig
) {
  const response = await api.listActiveMetrics({
    from: hoursAgo(24),
    host: undefined,
    tagFilter: params.query
  })

  const metrics = response.metrics ?? []

  return {
    metrics,
    total: response.metrics?.length ?? 0
  }
}

export async function getMetricMetadata(api: v1.MetricsApi, metricName: string) {
  const metadata = await api.getMetricMetadata({ metricName })

  return {
    metric: metricName,
    description: metadata.description ?? '',
    unit: metadata.unit ?? '',
    perUnit: metadata.perUnit ?? '',
    type: metadata.type ?? '',
    shortName: metadata.shortName ?? '',
    integration: metadata.integration ?? ''
  }
}

export function registerMetricsTool(
  server: McpServer,
  metricsV1Api: v1.MetricsApi,
  metricsV2Api: v2.MetricsApi,
  limits: LimitsConfig,
  site: string = 'datadoghq.com'
): void {
  server.tool(
    'metrics',
    `Query Datadog metrics. Actions:
- query: Get timeseries data (requires from/to time range, PromQL query)
- search: Find metrics by name (grep-like, NO time param needed)
- list: Get recently active metrics (last 24h, optionally filter by tag)
- metadata: Get metric details (unit, type, description)

APM METRICS (auto-generated from traces):
- trace.{service}.hits - Request count
- trace.{service}.errors - Error count
- trace.{service}.duration - Latency (use avg:, p95:, max:)
Example: max:trace.{service}.request.duration{*}`,
    InputSchema,
    async ({ action, query, from, to, metric, limit, pointLimit }) => {
      try {
        switch (action) {
          case 'query': {
            const metricsQuery = requireParam(query, 'query', 'query')
            return toolResult(
              await queryMetrics(
                metricsV1Api,
                {
                  query: metricsQuery,
                  from,
                  to,
                  pointLimit
                },
                limits,
                site
              )
            )
          }

          case 'search': {
            const searchQuery = requireParam(query, 'query', 'search')
            return toolResult(
              await searchMetrics(
                metricsV1Api,
                {
                  query: searchQuery,
                  limit
                },
                limits
              )
            )
          }

          case 'list':
            return toolResult(await listMetrics(metricsV1Api, { query }, limits))

          case 'metadata': {
            const metricName = requireParam(metric, 'metric', 'metadata')
            return toolResult(await getMetricMetadata(metricsV1Api, metricName))
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
