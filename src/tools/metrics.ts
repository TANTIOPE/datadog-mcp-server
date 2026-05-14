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

/**
 * Whitelisted Datadog rollup methods (mirrors src/schema/metrics.ts rollupMethods).
 */
const ROLLUP_METHODS = new Set(['avg', 'max', 'min', 'sum', 'count'])

/**
 * Default rollup method per Datadog docs when only an interval is passed
 * (e.g. `rollup(60)`). We surface this via `methodInferred: true` so callers
 * can tell the difference between an echo of their request and our default.
 * Source: https://docs.datadoghq.com/dashboards/functions/rollup/
 */
const DEFAULT_ROLLUP_METHOD = 'avg'

/**
 * Requested rollup parsed out of the query string.
 *
 * `methodInferred` resolves design.md OQ-3: when the query only specifies an
 * interval (e.g. `rollup(60)`), Datadog defaults to `avg`. We echo that default
 * and flag it so the caller doesn't mistake it for an explicit request.
 */
export interface ParsedRollup {
  interval: number
  method: string
  methodInferred: boolean
}

/**
 * Extract a `rollup(method, seconds)` clause from a Datadog metrics query string.
 *
 * Tolerant by design — returns `null` rather than throwing on:
 *   - missing rollup clause
 *   - unrecognized rollup method
 *   - non-integer interval
 *   - empty argument list
 *
 * Supported forms:
 *   - `rollup(method, seconds)` → both fields parsed, `methodInferred: false`
 *   - `rollup(seconds)`         → method defaults to `avg`, `methodInferred: true`
 *
 * Whitespace inside the parentheses is tolerated.
 */
export function parseRollupFromQuery(query: string): ParsedRollup | null {
  if (typeof query !== 'string') return null
  // Match the LAST rollup(...) call in the query so chained expressions like
  // `default_zero(...).rollup(sum, 900).as_count()` resolve to the outermost rollup.
  // We use a non-greedy capture and an explicit closing-paren anchor so nested
  // parens inside the rollup args don't trip the match (the supported subset is
  // simple: method + interval). The `g` flag with `matchAll` gives us all candidates.
  const matches = [...query.matchAll(/\.rollup\(\s*([^)]*?)\s*\)/g)]
  const lastMatch = matches[matches.length - 1]
  if (lastMatch === undefined) return null

  const inner = lastMatch[1]
  if (inner === undefined || inner.length === 0) return null

  const parts = inner.split(',').map((p) => p.trim())

  if (parts.length === 1) {
    // rollup(seconds) — only the interval is provided; method defaults to avg.
    const raw = parts[0] ?? ''
    const interval = Number.parseInt(raw, 10)
    if (!Number.isFinite(interval) || interval <= 0 || String(interval) !== raw) {
      return null
    }
    return { interval, method: DEFAULT_ROLLUP_METHOD, methodInferred: true }
  }

  if (parts.length === 2) {
    const method = parts[0] ?? ''
    const secondsRaw = parts[1] ?? ''
    if (!ROLLUP_METHODS.has(method)) return null
    const interval = Number.parseInt(secondsRaw, 10)
    if (!Number.isFinite(interval) || interval <= 0 || String(interval) !== secondsRaw) {
      return null
    }
    return { interval, method, methodInferred: false }
  }

  return null
}

/**
 * Compute the rollup-effective metadata from a Datadog series payload.
 *
 * Datadog's response doesn't expose the rollup interval directly — we derive it
 * from the spacing between the first two points in each series (in ms, converted
 * to seconds). Single-point series contribute nothing (we can't measure spacing).
 *
 * Returns:
 *   - `null` when no observable interval can be derived (empty series or all
 *     series have <2 points). In that case `rollupOverridden` cannot be asserted
 *     and must default to `false`.
 *   - `{ interval, intervalsObserved? }` otherwise. `intervalsObserved` is the
 *     deduped, ascending list when more than one distinct interval was observed.
 */
function computeEffectiveRollup(
  series: ReadonlyArray<{ pointlist?: ReadonlyArray<[number, number]> }>
): { interval: number; intervalsObserved?: number[] } | null {
  const intervals: number[] = []
  for (const s of series) {
    const pts = s.pointlist ?? []
    if (pts.length < 2) continue
    const first = pts[0]
    const second = pts[1]
    if (first === undefined || second === undefined) continue
    const deltaMs = (second[0] ?? 0) - (first[0] ?? 0)
    if (deltaMs <= 0) continue
    intervals.push(Math.round(deltaMs / 1000))
  }
  const primary = intervals[0]
  if (primary === undefined) return null

  const unique = Array.from(new Set(intervals)).sort((a, b) => a - b)
  if (unique.length === 1) {
    return { interval: primary }
  }
  return { interval: primary, intervalsObserved: unique }
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

  const rawSeries = response.series ?? []
  const series: MetricSeriesData[] = rawSeries.map((s) => ({
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

  // Rollup-override metadata (design.md Requirement 2).
  // Effective interval is computed from raw `pointlist` so it stays accurate
  // even when the caller passed a small `pointLimit`.
  const rollupRequested = parseRollupFromQuery(params.query)
  const rollupEffective = computeEffectiveRollup(
    rawSeries.map((s) => ({
      pointlist: (s.pointlist ?? []) as ReadonlyArray<[number, number]>
    }))
  )
  const rollupOverridden =
    rollupRequested !== null &&
    rollupEffective !== null &&
    (rollupEffective.interval !== rollupRequested.interval ||
      (rollupEffective.intervalsObserved?.some((i) => i !== rollupRequested.interval) ?? false))

  return {
    series,
    meta: {
      query: params.query,
      from: new Date(fromTs * 1000).toISOString(),
      to: new Date(toTs * 1000).toISOString(),
      seriesCount: series.length,
      datadog_url: buildMetricsUrl(params.query, fromTs, toTs, site),
      rollupRequested,
      rollupEffective,
      rollupOverridden
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
Keyed by OPERATION name (e.g. express.request, pg.query), NOT service name.
Filter by service using tags: {service:my-service}

PERCENTILES (p50/p75/p90/p95/p99) — use the ROOT metric (distribution type):
  p95:trace.express.request{service:my-service}

AVG/SUM/MIN/MAX — use the .duration SUFFIX (pre-aggregated gauge):
  avg:trace.express.request.duration{service:my-service}

Other trace metrics (gauges):
- trace.<operation>.hits - Request count
- trace.<operation>.errors - Error count
- trace.<operation>.apdex - Apdex score

To discover operation names for a service, use: traces tool with action "services"`,
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
