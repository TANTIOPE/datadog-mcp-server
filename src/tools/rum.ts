import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v2 } from '@datadog/datadog-api-client'
import { handleDatadogError } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import { parseTime } from '../utils/time.js'
import { buildRumUrl, buildRumSessionUrl } from '../utils/urls.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['applications', 'events', 'aggregate', 'performance', 'waterfall'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  query: z.string().optional().describe('RUM query string (e.g., "@type:view @application.id:abc")'),
  from: z.string().optional().describe('Start time (ISO 8601, relative like "1h", "7d", or precise like "1d@10:00")'),
  to: z.string().optional().describe('End time (ISO 8601, relative like "now", or precise timestamp)'),
  type: z.enum(['all', 'view', 'action', 'error', 'long_task', 'resource']).optional().describe('RUM event type filter'),
  sort: z.enum(['timestamp', '-timestamp']).optional().describe('Sort order for events'),
  limit: z.number().optional().describe('Maximum number of events to return'),
  groupBy: z.array(z.string()).optional().describe('Fields to group by for aggregation (e.g., ["@view.url_path", "@session.type"])'),
  compute: z.object({
    aggregation: z.enum(['count', 'cardinality', 'avg', 'sum', 'min', 'max', 'percentile']).optional(),
    metric: z.string().optional(),
    interval: z.string().optional()
  }).optional().describe('Compute configuration for aggregation'),
  // Performance action parameters
  metrics: z.array(z.enum(['lcp', 'fcp', 'cls', 'fid', 'inp', 'loading_time'])).optional()
    .describe('Core Web Vitals metrics to retrieve (default: all). lcp=Largest Contentful Paint, fcp=First Contentful Paint, cls=Cumulative Layout Shift, fid=First Input Delay, inp=Interaction to Next Paint, loading_time=View loading time'),
  // Waterfall action parameters
  applicationId: z.string().optional().describe('Application ID for waterfall action'),
  sessionId: z.string().optional().describe('Session ID for waterfall action'),
  viewId: z.string().optional().describe('View ID for waterfall action (optional, filters to specific view)')
}

interface RumApplicationSummary {
  id: string
  name: string
  type: string
  orgId: number
  hash: string | null
  createdAt: string
  updatedAt: string
}

interface RumEventSummary {
  id: string
  type: string
  timestamp: string
  attributes: {
    application: {
      id: string | null
      name: string | null
    }
    session: {
      id: string | null
      type: string | null
    }
    view: {
      id: string | null
      url: string | null
      urlPath: string | null
      name: string | null
    }
    user: {
      id: string | null
      email: string | null
      name: string | null
    }
    action?: {
      id: string | null
      type: string | null
      name: string | null
    }
    error?: {
      message: string | null
      source: string | null
      stack: string | null
    }
    resource?: {
      url: string | null
      type: string | null
      duration: number | null
    }
  }
}

function formatApplication(app: v2.RUMApplicationList): RumApplicationSummary {
  const attrs = app.attributes ?? {}

  return {
    id: app.id ?? '',
    name: attrs.name ?? '',
    type: String(attrs.type ?? ''),
    orgId: attrs.orgId ?? 0,
    hash: attrs.hash ?? null,
    createdAt: attrs.createdAt ? new Date(attrs.createdAt).toISOString() : '',
    updatedAt: attrs.updatedAt ? new Date(attrs.updatedAt).toISOString() : ''
  }
}

function formatEvent(event: v2.RUMEvent): RumEventSummary {
  const attrs = event.attributes ?? {}
  const appAttrs = (attrs.attributes ?? {}) as Record<string, unknown>

  // Extract nested attributes safely
  const application = (appAttrs['application'] ?? {}) as Record<string, unknown>
  const session = (appAttrs['session'] ?? {}) as Record<string, unknown>
  const view = (appAttrs['view'] ?? {}) as Record<string, unknown>
  const usr = (appAttrs['usr'] ?? {}) as Record<string, unknown>
  const action = (appAttrs['action'] ?? {}) as Record<string, unknown>
  const error = (appAttrs['error'] ?? {}) as Record<string, unknown>
  const resource = (appAttrs['resource'] ?? {}) as Record<string, unknown>

  return {
    id: event.id ?? '',
    type: String(event.type ?? ''),
    timestamp: attrs.timestamp?.toISOString() ?? '',
    attributes: {
      application: {
        id: (application['id'] as string) ?? null,
        name: (application['name'] as string) ?? null
      },
      session: {
        id: (session['id'] as string) ?? null,
        type: (session['type'] as string) ?? null
      },
      view: {
        id: (view['id'] as string) ?? null,
        url: (view['url'] as string) ?? null,
        urlPath: (view['url_path'] as string) ?? null,
        name: (view['name'] as string) ?? null
      },
      user: {
        id: (usr['id'] as string) ?? null,
        email: (usr['email'] as string) ?? null,
        name: (usr['name'] as string) ?? null
      },
      action: action['id'] ? {
        id: (action['id'] as string) ?? null,
        type: (action['type'] as string) ?? null,
        name: (action['name'] as string) ?? null
      } : undefined,
      error: error['message'] ? {
        message: (error['message'] as string) ?? null,
        source: (error['source'] as string) ?? null,
        stack: (error['stack'] as string) ?? null
      } : undefined,
      resource: resource['url'] ? {
        url: (resource['url'] as string) ?? null,
        type: (resource['type'] as string) ?? null,
        duration: (resource['duration'] as number) ?? null
      } : undefined
    }
  }
}

async function listApplications(api: v2.RUMApi) {
  const response = await api.getRUMApplications()
  const applications = (response.data ?? []).map(formatApplication)

  return {
    applications,
    totalCount: applications.length
  }
}

async function searchEvents(
  api: v2.RUMApi,
  params: {
    query?: string
    from?: string
    to?: string
    type?: string
    sort?: 'timestamp' | '-timestamp'
    limit?: number
  },
  limits: LimitsConfig,
  site: string
) {
  // Build query with type filter
  let queryString = params.query ?? '*'
  if (params.type && params.type !== 'all') {
    queryString = `@type:${params.type} ${queryString}`.trim()
  }

  // Parse time range
  const nowMs = Date.now()
  const defaultFromMs = nowMs - 15 * 60 * 1000 // Default 15 minutes
  const fromTime = parseTime(params.from, Math.floor(defaultFromMs / 1000))
  const toTime = parseTime(params.to, Math.floor(nowMs / 1000))

  const response = await api.listRUMEvents({
    filterQuery: queryString,
    filterFrom: new Date(fromTime * 1000),
    filterTo: new Date(toTime * 1000),
    sort: params.sort === 'timestamp' ? 'timestamp' : '-timestamp',
    pageLimit: Math.min(params.limit ?? limits.maxResults, limits.maxResults)
  })

  const events = (response.data ?? []).map(formatEvent)

  return {
    events,
    meta: {
      totalCount: events.length,
      timeRange: {
        from: new Date(fromTime * 1000).toISOString(),
        to: new Date(toTime * 1000).toISOString()
      },
      datadog_url: buildRumUrl(queryString, fromTime, toTime, site)
    }
  }
}

async function aggregateEvents(
  api: v2.RUMApi,
  params: {
    query?: string
    from?: string
    to?: string
    groupBy?: string[]
    compute?: {
      aggregation?: string
      metric?: string
      interval?: string
    }
  },
  _limits: LimitsConfig,
  site: string
) {
  // Parse time range
  const nowMs = Date.now()
  const defaultFromMs = nowMs - 60 * 60 * 1000 // Default 1 hour
  const fromTime = parseTime(params.from, Math.floor(defaultFromMs / 1000))
  const toTime = parseTime(params.to, Math.floor(nowMs / 1000))

  // Build group by configurations
  const groupByConfigs: v2.RUMGroupBy[] = (params.groupBy ?? []).map(field => ({
    facet: field,
    limit: 10,
    sort: {
      type: 'measure' as const,
      aggregation: 'count' as v2.RUMAggregationFunction,
      order: 'desc' as const
    }
  }))

  // Build compute configuration - only include defined properties
  // Note: 'type' should only be set when metric is present, otherwise API rejects it
  const computeConfig: v2.RUMCompute = {
    aggregation: (params.compute?.aggregation ?? 'count') as v2.RUMAggregationFunction
  }
  if (params.compute?.metric) {
    computeConfig.metric = params.compute.metric
    computeConfig.type = 'total'
  }
  if (params.compute?.interval) {
    computeConfig.interval = params.compute.interval
    computeConfig.type = 'timeseries'
  }
  const computeConfigs: v2.RUMCompute[] = [computeConfig]

  const queryString = params.query ?? '*'
  const response = await api.aggregateRUMEvents({
    body: {
      filter: {
        query: queryString,
        from: new Date(fromTime * 1000).toISOString(),
        to: new Date(toTime * 1000).toISOString()
      },
      groupBy: groupByConfigs.length > 0 ? groupByConfigs : undefined,
      compute: computeConfigs
    }
  })

  // Format buckets from response
  const buckets = (response.data?.buckets ?? []).map(bucket => ({
    by: bucket.by ?? {},
    computes: bucket.computes ?? {}
  }))

  return {
    buckets,
    meta: {
      elapsed: response.meta?.elapsed ?? 0,
      timeRange: {
        from: new Date(fromTime * 1000).toISOString(),
        to: new Date(toTime * 1000).toISOString()
      },
      datadog_url: buildRumUrl(queryString, fromTime, toTime, site)
    }
  }
}

// Core Web Vitals metric configurations
const METRIC_CONFIGS: Record<string, { field: string; aggregations: v2.RUMAggregationFunction[] }> = {
  lcp: {
    field: '@view.largest_contentful_paint',
    aggregations: ['avg', 'pc75', 'pc90']
  },
  fcp: {
    field: '@view.first_contentful_paint',
    aggregations: ['avg', 'pc75', 'pc90']
  },
  cls: {
    field: '@view.cumulative_layout_shift',
    aggregations: ['avg', 'pc75']
  },
  fid: {
    field: '@view.first_input_delay',
    aggregations: ['avg', 'pc75', 'pc90']
  },
  inp: {
    field: '@view.interaction_to_next_paint',
    aggregations: ['avg', 'pc75', 'pc90']
  },
  loading_time: {
    field: '@view.loading_time',
    aggregations: ['avg', 'pc75', 'pc90']
  }
}

async function getPerformanceMetrics(
  api: v2.RUMApi,
  params: {
    query?: string
    from?: string
    to?: string
    groupBy?: string[]
    metrics?: string[]
  },
  _limits: LimitsConfig,
  site: string
) {
  // Parse time range
  const nowMs = Date.now()
  const defaultFromMs = nowMs - 60 * 60 * 1000 // Default 1 hour
  const fromTime = parseTime(params.from, Math.floor(defaultFromMs / 1000))
  const toTime = parseTime(params.to, Math.floor(nowMs / 1000))

  // Determine which metrics to query (default to 3 most important to stay under 10 computes limit)
  const requestedMetrics = params.metrics ?? ['lcp', 'fcp', 'cls']

  // Build compute configurations for all requested metrics
  const computeConfigs: v2.RUMCompute[] = []
  for (const metricName of requestedMetrics) {
    const config = METRIC_CONFIGS[metricName]
    if (!config) continue

    for (const aggregation of config.aggregations) {
      computeConfigs.push({
        aggregation,
        metric: config.field,
        type: 'total'
      })
    }
  }

  // Build group by configurations
  const groupByConfigs: v2.RUMGroupBy[] = (params.groupBy ?? []).map(field => ({
    facet: field,
    limit: 10,
    sort: {
      type: 'measure' as const,
      aggregation: 'count' as v2.RUMAggregationFunction,
      order: 'desc' as const
    }
  }))

  // Query must filter to view events only
  const viewQuery = params.query ? `@type:view ${params.query}` : '@type:view'

  const response = await api.aggregateRUMEvents({
    body: {
      filter: {
        query: viewQuery,
        from: new Date(fromTime * 1000).toISOString(),
        to: new Date(toTime * 1000).toISOString()
      },
      groupBy: groupByConfigs.length > 0 ? groupByConfigs : undefined,
      compute: computeConfigs
    }
  })

  // Format response into structured metrics
  const buckets = (response.data?.buckets ?? []).map(bucket => {
    const computes = bucket.computes as Record<string, { value?: number }> ?? {}
    const metrics: Record<string, Record<string, number | null>> = {}

    // Organize computes by metric name
    for (const metricName of requestedMetrics) {
      const config = METRIC_CONFIGS[metricName]
      if (!config) continue

      metrics[metricName] = {}
      for (const aggregation of config.aggregations) {
        // The key format in response is like "c0", "c1", etc. based on order
        // We need to find the matching compute by index
        const computeIndex = computeConfigs.findIndex(
          c => c.metric === config.field && c.aggregation === aggregation
        )
        const key = `c${computeIndex}`
        const value = computes[key]?.value
        metrics[metricName][String(aggregation)] = value ?? null
      }
    }

    return {
      by: bucket.by ?? {},
      metrics
    }
  })

  return {
    buckets,
    meta: {
      metrics: requestedMetrics,
      timeRange: {
        from: new Date(fromTime * 1000).toISOString(),
        to: new Date(toTime * 1000).toISOString()
      },
      datadog_url: buildRumUrl(viewQuery, fromTime, toTime, site)
    }
  }
}

interface WaterfallEvent {
  id: string
  type: string
  timestamp: string
  duration: number | null
  view: {
    id: string | null
    url: string | null
    name: string | null
  }
  resource?: {
    url: string | null
    type: string | null
    duration: number | null
    size: number | null
    statusCode: number | null
  }
  action?: {
    id: string | null
    type: string | null
    name: string | null
    target: string | null
  }
  error?: {
    message: string | null
    source: string | null
    type: string | null
  }
  longTask?: {
    duration: number | null
  }
}

function formatWaterfallEvent(event: v2.RUMEvent): WaterfallEvent {
  const attrs = event.attributes ?? {}
  const appAttrs = (attrs.attributes ?? {}) as Record<string, unknown>

  const view = (appAttrs['view'] ?? {}) as Record<string, unknown>
  const resource = (appAttrs['resource'] ?? {}) as Record<string, unknown>
  const action = (appAttrs['action'] ?? {}) as Record<string, unknown>
  const error = (appAttrs['error'] ?? {}) as Record<string, unknown>
  const longTask = (appAttrs['long_task'] ?? {}) as Record<string, unknown>

  // Event type is in nested attributes, not at top level
  const eventType = (appAttrs['type'] as string) ?? 'unknown'

  return {
    id: event.id ?? '',
    type: eventType,
    timestamp: attrs.timestamp?.toISOString() ?? '',
    duration: (view['loading_time'] as number) ?? (resource['duration'] as number) ?? null,
    view: {
      id: (view['id'] as string) ?? null,
      url: (view['url'] as string) ?? null,
      name: (view['name'] as string) ?? null
    },
    resource: resource['url'] ? {
      url: (resource['url'] as string) ?? null,
      type: (resource['type'] as string) ?? null,
      duration: (resource['duration'] as number) ?? null,
      size: (resource['size'] as number) ?? null,
      statusCode: (resource['status_code'] as number) ?? null
    } : undefined,
    action: action['id'] ? {
      id: (action['id'] as string) ?? null,
      type: (action['type'] as string) ?? null,
      name: (action['name'] as string) ?? null,
      target: (action['target'] as string) ?? null
    } : undefined,
    error: error['message'] ? {
      message: (error['message'] as string) ?? null,
      source: (error['source'] as string) ?? null,
      type: (error['type'] as string) ?? null
    } : undefined,
    longTask: longTask['duration'] ? {
      duration: (longTask['duration'] as number) ?? null
    } : undefined
  }
}

async function getSessionWaterfall(
  api: v2.RUMApi,
  params: {
    applicationId: string
    sessionId: string
    viewId?: string
  },
  limits: LimitsConfig,
  site: string
) {
  // Build query for specific session
  const queryParts = [
    `@application.id:${params.applicationId}`,
    `@session.id:${params.sessionId}`
  ]
  if (params.viewId) {
    queryParts.push(`@view.id:${params.viewId}`)
  }

  const response = await api.listRUMEvents({
    filterQuery: queryParts.join(' '),
    sort: 'timestamp',
    pageLimit: Math.min(limits.maxResults, 1000)
  })

  const events = (response.data ?? []).map(formatWaterfallEvent)

  // Group events by type for summary
  const summary = {
    views: events.filter(e => e.type === 'view').length,
    resources: events.filter(e => e.type === 'resource').length,
    actions: events.filter(e => e.type === 'action').length,
    errors: events.filter(e => e.type === 'error').length,
    longTasks: events.filter(e => e.type === 'long_task').length
  }

  return {
    events,
    summary,
    meta: {
      totalCount: events.length,
      applicationId: params.applicationId,
      sessionId: params.sessionId,
      viewId: params.viewId ?? null,
      datadog_url: buildRumSessionUrl(params.applicationId, params.sessionId, site)
    }
  }
}

export function registerRumTool(
  server: McpServer,
  api: v2.RUMApi,
  limits: LimitsConfig,
  site: string = 'datadoghq.com'
): void {
  server.tool(
    'rum',
    'Query Datadog Real User Monitoring (RUM) data. Actions: applications (list RUM apps), events (search RUM events), aggregate (group and count events), performance (Core Web Vitals: LCP, FCP, CLS, FID, INP), waterfall (session timeline with resources/actions/errors). Use for: frontend performance, user sessions, page views, errors, resource loading.',
    InputSchema,
    async ({ action, query, from, to, type, sort, limit, groupBy, compute, metrics, applicationId, sessionId, viewId }) => {
      try {
        switch (action) {
          case 'applications':
            return toolResult(await listApplications(api))

          case 'events':
            return toolResult(await searchEvents(api, { query, from, to, type, sort, limit }, limits, site))

          case 'aggregate':
            return toolResult(await aggregateEvents(api, { query, from, to, groupBy, compute }, limits, site))

          case 'performance':
            return toolResult(await getPerformanceMetrics(api, { query, from, to, groupBy, metrics }, limits, site))

          case 'waterfall':
            if (!applicationId || !sessionId) {
              throw new Error('waterfall action requires applicationId and sessionId parameters')
            }
            return toolResult(await getSessionWaterfall(api, { applicationId, sessionId, viewId }, limits, site))

          default:
            throw new Error(`Unknown action: ${action}`)
        }
      } catch (error) {
        handleDatadogError(error)
      }
    }
  )
}
