import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1, v2 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import { hoursAgo, now, parseTime, ensureValidTimeRange, parseDurationToNs } from '../utils/time.js'
import { buildEventsUrl } from '../utils/urls.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['list', 'get', 'create', 'search', 'aggregate', 'top', 'timeseries', 'incidents'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z.string().optional().describe('Event ID (for get action)'),
  query: z.string().optional().describe('Search query'),
  from: z.string().optional().describe('Start time (ISO 8601, relative like "1h", or Unix timestamp)'),
  to: z.string().optional().describe('End time (ISO 8601, relative like "1h", or Unix timestamp)'),
  priority: z.enum(['normal', 'low']).optional().describe('Event priority'),
  sources: z.array(z.string()).optional().describe('Filter by sources'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  limit: z.number().optional().describe('Maximum number of events to return'),
  title: z.string().optional().describe('Event title (for create)'),
  text: z.string().optional().describe('Event text (for create)'),
  alertType: z.enum(['error', 'warning', 'info', 'success']).optional().describe('Alert type (for create)'),
  groupBy: z.array(z.string()).optional().describe('Fields to group by: monitor_name, priority, alert_type, source'),
  cursor: z.string().optional().describe('Pagination cursor from previous response'),
  // Phase 2: Timeseries
  interval: z.string().optional().describe('Time bucket interval for timeseries: 1h, 4h, 1d (default: 1h)'),
  // Phase 2: Incidents deduplication
  dedupeWindow: z.string().optional().describe('Deduplication window for incidents: 5m, 15m, 1h (default: 5m)'),
  // Phase 3: Monitor enrichment
  enrich: z.boolean().optional().describe('Enrich events with monitor metadata (slower, adds monitor details)')
}

// v1 Event summary format
interface EventSummaryV1 {
  id: number
  title: string
  text: string
  dateHappened: string
  priority: string
  source: string
  tags: string[]
  alertType: string
  host: string
}

// v2 Event summary format
interface EventSummaryV2 {
  id: string
  title: string
  message: string
  timestamp: string
  priority: string
  source: string
  tags: string[]
  alertType: string
  host: string
  monitorId?: number
  monitorInfo?: {
    name: string
    status: string
    scope: string
    priority?: string
  }
}

// Aggregation bucket format
interface AggregationBucket {
  key: string
  count: number
  sample: EventSummaryV2
}

// Timeseries bucket format (Phase 2)
interface TimeseriesBucket {
  timestamp: string
  timestampMs: number
  counts: Record<string, number>
  total: number
}

// Incident format (Phase 2 - deduplicated events)
interface IncidentEvent {
  monitorName: string
  firstTrigger: string
  lastTrigger: string
  triggerCount: number
  recovered: boolean
  recoveredAt?: string
  duration?: string
  sample: EventSummaryV2
}

// Enriched event with monitor metadata (Phase 3)
interface EnrichedEvent extends EventSummaryV2 {
  monitorMetadata?: {
    id: number
    type: string
    message: string
    tags: string[]
    options?: {
      thresholds?: Record<string, number>
      notifyNoData?: boolean
      escalationMessage?: string
    }
  }
}

/**
 * Extract monitor information from alert event title
 * Handles patterns like:
 * - [Triggered on {scope}] Monitor Name
 * - [P1] [Triggered on {scope}] Monitor Name
 * - [Warn on {scope}] Monitor Name
 * - [Recovered on {scope}] Monitor Name
 */
function extractMonitorInfo(title: string): {
  status: string
  scope: string
  name: string
  priority?: string
} {
  // Extract priority prefix if present
  const priorityMatch = title.match(/^\[P(\d+)\]\s*/)
  const priority = priorityMatch ? `P${priorityMatch[1]}` : undefined
  const withoutPriority = title.replace(/^\[P\d+\]\s*/, '')

  // Extract status, scope, and name
  const match = withoutPriority.match(
    /^\[(Triggered|Recovered|Warn|Alert|OK|No Data|Re-Triggered|Renotify)(?:\s+on\s+\{([^}]+)\})?\]\s*(.+)$/i
  )

  if (match) {
    return {
      status: match[1] ?? '',
      scope: match[2] ?? '',
      name: match[3]?.trim() ?? title,
      priority
    }
  }

  return { status: '', scope: '', name: title, priority }
}

/**
 * Extract title/monitor name from v2 event message body
 * v2 API returns empty title, but message contains the alert text
 * Format: "%%%\nMonitor title here\n\n..."
 */
function extractTitleFromMessage(message: string): string {
  if (!message) return ''

  // Remove %%% markdown delimiter if present
  const content = message.replace(/^%%%\s*\n?/, '').trim()

  // Get first line (up to first newline)
  const firstLine = content.split('\n')[0]?.trim() ?? ''

  // Clean up common trailing patterns like " !" or extra whitespace
  return firstLine.replace(/\s+!?\s*$/, '').trim()
}

/**
 * Extract monitor ID from v2 event message body
 * Messages contain links like: [[Monitor Status](/monitors/67860480?...)]
 */
function extractMonitorIdFromMessage(message: string): number | undefined {
  if (!message) return undefined

  // Match /monitors/{id} pattern in the message
  const match = message.match(/\/monitors\/(\d+)/)
  if (match && match[1]) {
    const id = parseInt(match[1], 10)
    return isNaN(id) ? undefined : id
  }

  return undefined
}

/**
 * Build a group key for aggregation based on the event and groupBy fields
 */
function buildGroupKey(event: EventSummaryV2, groupBy: string[]): string {
  const parts: string[] = []

  for (const field of groupBy) {
    switch (field) {
      case 'monitor_name':
        parts.push(event.monitorInfo?.name ?? event.title)
        break
      case 'monitor_id':
        parts.push(event.monitorId?.toString() ?? '')
        break
      case 'priority':
        parts.push(event.monitorInfo?.priority ?? event.priority)
        break
      case 'source':
        parts.push(event.source)
        break
      case 'alert_type':
        parts.push(event.alertType)
        break
      case 'status':
        parts.push(event.monitorInfo?.status ?? '')
        break
      case 'host':
        parts.push(event.host)
        break
      default: {
        // For unknown fields, try to find in tags
        const tagValue = event.tags.find(t => t.startsWith(`${field}:`))?.split(':')[1] ?? ''
        parts.push(tagValue)
      }
    }
  }

  return parts.join('|')
}

function formatEventV1(e: v1.Event): EventSummaryV1 {
  const event = e as v1.Event & { sourceTypeName?: string }
  return {
    id: e.id ?? 0,
    title: e.title ?? '',
    text: e.text ?? '',
    dateHappened: e.dateHappened ? new Date(e.dateHappened * 1000).toISOString() : '',
    priority: String(e.priority ?? 'normal'),
    source: event.sourceTypeName ?? '',
    tags: e.tags ?? [],
    alertType: String(e.alertType ?? 'info'),
    host: e.host ?? ''
  }
}

function formatEventV2(e: v2.EventResponse): EventSummaryV2 {
  const attrs = e.attributes ?? {}

  // Parse timestamp
  let timestamp = ''
  if (attrs.timestamp) {
    const ts = attrs.timestamp
    timestamp = ts instanceof Date ? ts.toISOString() : new Date(String(ts)).toISOString()
  }

  const message = (attrs.message as string) ?? ''

  // v2 API often returns empty title - extract from message body instead
  let title = (attrs.title as string) ?? ''
  if (!title && message) {
    title = extractTitleFromMessage(message)
  }

  const monitorInfo = extractMonitorInfo(title)
  const monitorId = extractMonitorIdFromMessage(message)

  // Extract source from tags or attributes
  const tags = (attrs.tags as string[]) ?? []
  const sourceTag = tags.find(t => t.startsWith('source:'))
  const source = sourceTag?.split(':')[1] ?? ''

  // Extract alert_type from tags
  const alertTypeTag = tags.find(t => t.startsWith('alert_type:'))
  const alertType = alertTypeTag?.split(':')[1] ?? ''

  // Extract host from tags
  const hostTag = tags.find(t => t.startsWith('host:'))
  const host = hostTag?.split(':')[1] ?? ''

  // Extract priority from tags
  const priorityTag = tags.find(t => t.startsWith('priority:'))
  const priority = priorityTag?.split(':')[1] ?? 'normal'

  return {
    id: String(e.id ?? ''),
    title,
    message,
    timestamp,
    priority,
    source,
    tags,
    alertType,
    host,
    monitorId,
    monitorInfo: monitorInfo.name !== title ? {
      name: monitorInfo.name,
      status: monitorInfo.status,
      scope: monitorInfo.scope,
      priority: monitorInfo.priority
    } : undefined
  }
}

// ============ V1 API Functions (backward compatible) ============

async function listEventsV1(
  api: v1.EventsApi,
  params: {
    query?: string
    from?: string
    to?: string
    priority?: 'normal' | 'low'
    sources?: string[]
    tags?: string[]
    limit?: number
  },
  limits: LimitsConfig
) {
  const effectiveLimit = Math.min(params.limit ?? limits.defaultLimit, limits.maxResults)
  const defaultFrom = hoursAgo(limits.defaultTimeRangeHours)
  const defaultTo = now()

  const response = await api.listEvents({
    start: parseTime(params.from, defaultFrom),
    end: parseTime(params.to, defaultTo),
    priority: params.priority === 'low' ? 'low' : 'normal',
    sources: params.sources?.join(','),
    tags: params.tags?.join(','),
    unaggregated: true
  })

  let events = response.events ?? []

  // Client-side query filter
  if (params.query) {
    const lowerQuery = params.query.toLowerCase()
    events = events.filter(e =>
      e.title?.toLowerCase().includes(lowerQuery) ||
      e.text?.toLowerCase().includes(lowerQuery)
    )
  }

  const result = events.slice(0, effectiveLimit).map(formatEventV1)

  return {
    events: result,
    total: events.length
  }
}

async function getEventV1(api: v1.EventsApi, id: string) {
  const eventId = parseInt(id, 10)
  if (isNaN(eventId)) {
    throw new Error(`Invalid event ID: ${id}`)
  }

  const response = await api.getEvent({ eventId })
  return { event: formatEventV1(response.event ?? {}) }
}

async function createEventV1(
  api: v1.EventsApi,
  params: {
    title: string
    text: string
    priority?: 'normal' | 'low'
    tags?: string[]
    alertType?: 'error' | 'warning' | 'info' | 'success'
  }
) {
  const body: v1.EventCreateRequest = {
    title: params.title,
    text: params.text,
    priority: params.priority === 'low' ? 'low' : 'normal',
    tags: params.tags,
    alertType: params.alertType ?? 'info'
  }

  const response = await api.createEvent({ body })

  return {
    success: true,
    event: {
      id: response.event?.id ?? 0,
      title: response.event?.title ?? '',
      status: response.status ?? ''
    }
  }
}

// ============ V2 API Functions (new capabilities) ============

/**
 * Build a Datadog event search query from filter parameters
 */
function buildEventQuery(params: {
  query?: string
  sources?: string[]
  tags?: string[]
  priority?: string
}): string {
  const parts: string[] = []

  if (params.query) {
    parts.push(params.query)
  }

  if (params.sources && params.sources.length > 0) {
    const sourceFilter = params.sources.map(s => `source:${s}`).join(' OR ')
    parts.push(`(${sourceFilter})`)
  }

  if (params.tags && params.tags.length > 0) {
    for (const tag of params.tags) {
      parts.push(tag)
    }
  }

  if (params.priority) {
    parts.push(`priority:${params.priority}`)
  }

  return parts.length > 0 ? parts.join(' ') : '*'
}

async function searchEventsV2(
  api: v2.EventsApi,
  params: {
    query?: string
    from?: string
    to?: string
    sources?: string[]
    tags?: string[]
    priority?: string
    limit?: number
    cursor?: string
  },
  limits: LimitsConfig,
  site: string
) {
  const defaultFrom = hoursAgo(limits.defaultTimeRangeHours)
  const defaultTo = now()

  const [validFrom, validTo] = ensureValidTimeRange(
    parseTime(params.from, defaultFrom),
    parseTime(params.to, defaultTo)
  )
  const fromTime = new Date(validFrom * 1000).toISOString()
  const toTime = new Date(validTo * 1000).toISOString()

  const fullQuery = buildEventQuery({
    query: params.query,
    sources: params.sources,
    tags: params.tags,
    priority: params.priority
  })

  const effectiveLimit = Math.min(params.limit ?? limits.defaultLimit, limits.maxResults)

  const body: v2.EventsListRequest = {
    filter: {
      query: fullQuery,
      from: fromTime,
      to: toTime
    },
    sort: 'timestamp' as v2.EventsSort,
    page: {
      limit: effectiveLimit,
      cursor: params.cursor
    }
  }

  const response = await api.searchEvents({ body })

  const events = (response.data ?? []).map(formatEventV2)
  const nextCursor = response.meta?.page?.after

  return {
    events,
    meta: {
      count: events.length,
      query: fullQuery,
      from: fromTime,
      to: toTime,
      nextCursor,
      datadog_url: buildEventsUrl(fullQuery, validFrom, validTo, site)
    }
  }
}

/**
 * Client-side aggregation for events
 * Streams through all matching events and counts by group key
 */
async function aggregateEventsV2(
  api: v2.EventsApi,
  params: {
    query?: string
    from?: string
    to?: string
    sources?: string[]
    tags?: string[]
    groupBy?: string[]
    limit?: number
  },
  limits: LimitsConfig,
  site: string
) {
  const counts = new Map<string, { count: number; sample: EventSummaryV2 }>()

  const defaultFrom = hoursAgo(limits.defaultTimeRangeHours)
  const defaultTo = now()

  const [validFrom, validTo] = ensureValidTimeRange(
    parseTime(params.from, defaultFrom),
    parseTime(params.to, defaultTo)
  )
  const fromTime = new Date(validFrom * 1000).toISOString()
  const toTime = new Date(validTo * 1000).toISOString()

  const fullQuery = buildEventQuery({
    query: params.query,
    sources: params.sources,
    tags: params.tags
  })

  const groupByFields = params.groupBy ?? ['monitor_name']

  // Use pagination to stream through all events
  // Limit to maxEventsToAggregate to prevent runaway queries
  const maxEventsToAggregate = 10000
  let eventCount = 0
  let pageCount = 0
  const maxPages = 100

  const body: v2.EventsListRequest = {
    filter: {
      query: fullQuery,
      from: fromTime,
      to: toTime
    },
    sort: 'timestamp' as v2.EventsSort,
    page: {
      limit: 1000 // Max per page
    }
  }

  // Manual pagination since searchEventsWithPagination may not be available
  let cursor: string | undefined

  while (pageCount < maxPages && eventCount < maxEventsToAggregate) {
    const pageBody = { ...body, page: { ...body.page, cursor } }
    const response = await api.searchEvents({ body: pageBody })

    const events = response.data ?? []
    if (events.length === 0) break

    for (const event of events) {
      const formatted = formatEventV2(event)
      const groupKey = buildGroupKey(formatted, groupByFields)

      const existing = counts.get(groupKey)
      if (existing) {
        existing.count++
      } else {
        counts.set(groupKey, { count: 1, sample: formatted })
      }

      eventCount++
      if (eventCount >= maxEventsToAggregate) break
    }

    cursor = response.meta?.page?.after
    if (!cursor) break
    pageCount++
  }

  // Sort by count descending, apply limit
  const effectiveLimit = Math.min(params.limit ?? 100, 1000)
  const sorted = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, effectiveLimit)

  const buckets: AggregationBucket[] = sorted.map(([key, data]) => ({
    key,
    count: data.count,
    sample: data.sample
  }))

  return {
    buckets,
    meta: {
      query: fullQuery,
      from: fromTime,
      to: toTime,
      groupBy: groupByFields,
      totalGroups: counts.size,
      totalEvents: eventCount,
      truncated: eventCount >= maxEventsToAggregate,
      datadog_url: buildEventsUrl(fullQuery, validFrom, validTo, site)
    }
  }
}

/**
 * Top N events by count - convenience wrapper for aggregate
 * Direct answer to "which monitors triggered the most alerts"
 */
async function topEventsV2(
  api: v2.EventsApi,
  params: {
    query?: string
    from?: string
    to?: string
    sources?: string[]
    tags?: string[]
    groupBy?: string[]
    limit?: number
  },
  limits: LimitsConfig,
  site: string
) {
  // Default to source:alert for alert-related queries
  const effectiveQuery = params.query ?? 'source:alert'
  const effectiveTags = params.tags ?? ['source:alert']

  const result = await aggregateEventsV2(api, {
    ...params,
    query: effectiveQuery,
    tags: effectiveTags,
    groupBy: params.groupBy ?? ['monitor_name'],
    limit: params.limit ?? 10
  }, limits, site)

  // Format for easier consumption
  return {
    top: result.buckets.map((bucket, index) => ({
      rank: index + 1,
      name: bucket.key,
      monitorId: bucket.sample.monitorId,
      alertCount: bucket.count,
      lastAlert: bucket.sample.timestamp,
      sample: {
        title: bucket.sample.title,
        source: bucket.sample.source,
        alertType: bucket.sample.alertType
      }
    })),
    meta: result.meta
  }
}

// ============ Phase 2: Timeseries Action ============

/**
 * Parse interval string to milliseconds
 * Supports: 1h, 4h, 1d, 15m, etc.
 */
function parseIntervalToMs(interval: string | undefined): number {
  const ns = parseDurationToNs(interval ?? '1h')
  return ns ? Math.floor(ns / 1000000) : 3600000 // default 1h
}

/**
 * Time-bucketed alert trends
 * Buckets events by time interval and groups by specified fields
 */
async function timeseriesEventsV2(
  api: v2.EventsApi,
  params: {
    query?: string
    from?: string
    to?: string
    sources?: string[]
    tags?: string[]
    groupBy?: string[]
    interval?: string
    limit?: number
  },
  limits: LimitsConfig,
  site: string
) {
  const defaultFrom = hoursAgo(limits.defaultTimeRangeHours)
  const defaultTo = now()

  const [validFrom, validTo] = ensureValidTimeRange(
    parseTime(params.from, defaultFrom),
    parseTime(params.to, defaultTo)
  )
  const fromTime = new Date(validFrom * 1000).toISOString()
  const toTime = new Date(validTo * 1000).toISOString()

  const fullQuery = buildEventQuery({
    query: params.query ?? 'source:alert',
    sources: params.sources,
    tags: params.tags ?? ['source:alert']
  })

  const intervalMs = parseIntervalToMs(params.interval)
  const groupByFields = params.groupBy ?? ['monitor_name']

  // Map: bucketTs -> groupKey -> count
  const timeBuckets = new Map<number, Map<string, number>>()

  const maxEventsToProcess = 10000
  let eventCount = 0
  let pageCount = 0
  const maxPages = 100

  const body: v2.EventsListRequest = {
    filter: {
      query: fullQuery,
      from: fromTime,
      to: toTime
    },
    sort: 'timestamp' as v2.EventsSort,
    page: { limit: 1000 }
  }

  let cursor: string | undefined

  while (pageCount < maxPages && eventCount < maxEventsToProcess) {
    const pageBody = { ...body, page: { ...body.page, cursor } }
    const response = await api.searchEvents({ body: pageBody })

    const events = response.data ?? []
    if (events.length === 0) break

    for (const event of events) {
      const formatted = formatEventV2(event)
      const groupKey = buildGroupKey(formatted, groupByFields)

      // Parse timestamp and bucket it
      const eventTs = new Date(formatted.timestamp).getTime()
      const bucketTs = Math.floor(eventTs / intervalMs) * intervalMs

      if (!timeBuckets.has(bucketTs)) {
        timeBuckets.set(bucketTs, new Map())
      }
      const groupCounts = timeBuckets.get(bucketTs)!
      groupCounts.set(groupKey, (groupCounts.get(groupKey) ?? 0) + 1)

      eventCount++
      if (eventCount >= maxEventsToProcess) break
    }

    cursor = response.meta?.page?.after
    if (!cursor) break
    pageCount++
  }

  // Convert to sorted array of buckets
  const sortedBuckets = [...timeBuckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucketTs, groupCounts]) => {
      const counts: Record<string, number> = {}
      let total = 0
      for (const [key, count] of groupCounts) {
        counts[key] = count
        total += count
      }
      return {
        timestamp: new Date(bucketTs).toISOString(),
        timestampMs: bucketTs,
        counts,
        total
      } satisfies TimeseriesBucket
    })

  // Apply limit to buckets if specified
  const effectiveLimit = params.limit ?? 100
  const limitedBuckets = sortedBuckets.slice(0, effectiveLimit)

  return {
    timeseries: limitedBuckets,
    meta: {
      query: fullQuery,
      from: fromTime,
      to: toTime,
      interval: params.interval ?? '1h',
      intervalMs,
      groupBy: groupByFields,
      totalBuckets: sortedBuckets.length,
      totalEvents: eventCount,
      truncated: eventCount >= maxEventsToProcess,
      datadog_url: buildEventsUrl(fullQuery, validFrom, validTo, site)
    }
  }
}

// ============ Phase 2: Incidents Action (Deduplication) ============

/**
 * Deduplicate alert events into incidents
 * Groups Triggered events within a time window, pairs with Recovered events
 */
async function incidentsEventsV2(
  api: v2.EventsApi,
  params: {
    query?: string
    from?: string
    to?: string
    sources?: string[]
    tags?: string[]
    dedupeWindow?: string
    limit?: number
  },
  limits: LimitsConfig,
  site: string
) {
  const defaultFrom = hoursAgo(limits.defaultTimeRangeHours)
  const defaultTo = now()

  const [validFrom, validTo] = ensureValidTimeRange(
    parseTime(params.from, defaultFrom),
    parseTime(params.to, defaultTo)
  )
  const fromTime = new Date(validFrom * 1000).toISOString()
  const toTime = new Date(validTo * 1000).toISOString()

  const fullQuery = buildEventQuery({
    query: params.query ?? 'source:alert',
    sources: params.sources,
    tags: params.tags ?? ['source:alert']
  })

  // Parse dedupe window (default 5 minutes)
  const dedupeWindowNs = parseDurationToNs(params.dedupeWindow ?? '5m')
  const dedupeWindowMs = dedupeWindowNs ? Math.floor(dedupeWindowNs / 1000000) : 300000

  // Track incidents per monitor
  interface IncidentTracker {
    monitorName: string
    firstTrigger: Date
    lastTrigger: Date
    triggerCount: number
    recovered: boolean
    recoveredAt?: Date
    sample: EventSummaryV2
  }
  const incidents = new Map<string, IncidentTracker>()

  const maxEventsToProcess = 10000
  let eventCount = 0
  let pageCount = 0
  const maxPages = 100

  const body: v2.EventsListRequest = {
    filter: {
      query: fullQuery,
      from: fromTime,
      to: toTime
    },
    sort: 'timestamp' as v2.EventsSort,
    page: { limit: 1000 }
  }

  let cursor: string | undefined

  while (pageCount < maxPages && eventCount < maxEventsToProcess) {
    const pageBody = { ...body, page: { ...body.page, cursor } }
    const response = await api.searchEvents({ body: pageBody })

    const events = response.data ?? []
    if (events.length === 0) break

    for (const event of events) {
      const formatted = formatEventV2(event)

      // Use monitorInfo.name if available, otherwise fall back to title
      const monitorName = formatted.monitorInfo?.name ?? formatted.title
      if (!monitorName) {
        eventCount++
        continue
      }

      const eventTs = new Date(formatted.timestamp)

      // Derive status from monitorInfo, alertType, or message content for v2 events
      let status = formatted.monitorInfo?.status?.toLowerCase() ?? ''
      if (!status && formatted.alertType) {
        // Map alertType to status for v2 events without structured monitorInfo
        const alertType = formatted.alertType.toLowerCase()
        if (alertType === 'error' || alertType === 'warning') {
          status = 'triggered'
        } else if (alertType === 'success') {
          status = 'recovered'
        }
      }
      // For source:alert events without explicit status, check message for recovery indicators
      // or default to 'triggered' since alert events are triggers by nature
      if (!status && formatted.source === 'alert') {
        const msgLower = formatted.message.toLowerCase()
        if (msgLower.includes('recovered') || msgLower.includes('[ok]') || msgLower.includes('resolved')) {
          status = 'recovered'
        } else {
          status = 'triggered'
        }
      }

      const existing = incidents.get(monitorName)

      if (status === 'triggered' || status === 'alert' || status === 're-triggered' || status === 'renotify') {
        if (existing) {
          // Check if within dedupe window
          const timeSinceLastTrigger = eventTs.getTime() - existing.lastTrigger.getTime()
          if (timeSinceLastTrigger <= dedupeWindowMs) {
            // Same incident, update
            existing.lastTrigger = eventTs
            existing.triggerCount++
            existing.sample = formatted // Keep latest sample
          } else {
            // New incident for this monitor, close old one
            // Store the old one with a unique key
            const oldKey = `${monitorName}::${existing.firstTrigger.toISOString()}`
            incidents.set(oldKey, existing)

            // Start new incident
            incidents.set(monitorName, {
              monitorName,
              firstTrigger: eventTs,
              lastTrigger: eventTs,
              triggerCount: 1,
              recovered: false,
              sample: formatted
            })
          }
        } else {
          // First trigger for this monitor
          incidents.set(monitorName, {
            monitorName,
            firstTrigger: eventTs,
            lastTrigger: eventTs,
            triggerCount: 1,
            recovered: false,
            sample: formatted
          })
        }
      } else if (status === 'recovered' || status === 'ok') {
        if (existing && !existing.recovered) {
          existing.recovered = true
          existing.recoveredAt = eventTs
        }
      }

      eventCount++
      if (eventCount >= maxEventsToProcess) break
    }

    cursor = response.meta?.page?.after
    if (!cursor) break
    pageCount++
  }

  // Convert to array and calculate durations
  const incidentList: IncidentEvent[] = [...incidents.values()].map(inc => {
    let duration: string | undefined
    if (inc.recoveredAt) {
      const durationMs = inc.recoveredAt.getTime() - inc.firstTrigger.getTime()
      if (durationMs < 60000) {
        duration = `${Math.round(durationMs / 1000)}s`
      } else if (durationMs < 3600000) {
        duration = `${Math.round(durationMs / 60000)}m`
      } else {
        duration = `${(durationMs / 3600000).toFixed(1)}h`
      }
    }

    return {
      monitorName: inc.monitorName,
      firstTrigger: inc.firstTrigger.toISOString(),
      lastTrigger: inc.lastTrigger.toISOString(),
      triggerCount: inc.triggerCount,
      recovered: inc.recovered,
      recoveredAt: inc.recoveredAt?.toISOString(),
      duration,
      sample: inc.sample
    }
  })

  // Sort by first trigger descending, apply limit
  incidentList.sort((a, b) => new Date(b.firstTrigger).getTime() - new Date(a.firstTrigger).getTime())
  const effectiveLimit = Math.min(params.limit ?? 100, 500)

  return {
    incidents: incidentList.slice(0, effectiveLimit),
    meta: {
      query: fullQuery,
      from: fromTime,
      to: toTime,
      dedupeWindow: params.dedupeWindow ?? '5m',
      dedupeWindowMs,
      totalIncidents: incidentList.length,
      totalEvents: eventCount,
      recoveredCount: incidentList.filter(i => i.recovered).length,
      activeCount: incidentList.filter(i => !i.recovered).length,
      truncated: eventCount >= maxEventsToProcess,
      datadog_url: buildEventsUrl(fullQuery, validFrom, validTo, site)
    }
  }
}

// ============ Phase 3: Monitor Metadata Enrichment ============

/**
 * Enrich events with monitor metadata from the Monitors API
 */
async function enrichWithMonitorMetadata(
  events: EventSummaryV2[],
  monitorsApi: v1.MonitorsApi
): Promise<EnrichedEvent[]> {
  // Extract unique monitor names
  const monitorNames = new Set<string>()
  for (const event of events) {
    if (event.monitorInfo?.name) {
      monitorNames.add(event.monitorInfo.name)
    }
  }

  if (monitorNames.size === 0) {
    return events as EnrichedEvent[]
  }

  // Fetch monitors - search by name
  const monitorCache = new Map<string, v1.Monitor>()

  try {
    // Fetch all monitors and filter locally
    // The API doesn't support searching by exact name, so we need to filter
    const response = await monitorsApi.listMonitors({
      pageSize: 1000
    })

    const monitors = response ?? []
    for (const monitor of monitors) {
      if (monitor.name) {
        monitorCache.set(monitor.name, monitor)
      }
    }
  } catch {
    // If monitor fetch fails, return events without enrichment
    return events as EnrichedEvent[]
  }

  // Enrich events
  return events.map(event => {
    const enriched: EnrichedEvent = { ...event }

    if (event.monitorInfo?.name) {
      const monitor = monitorCache.get(event.monitorInfo.name)
      if (monitor) {
        enriched.monitorMetadata = {
          id: monitor.id ?? 0,
          type: String(monitor.type ?? ''),
          message: monitor.message ?? '',
          tags: monitor.tags ?? [],
          options: {
            thresholds: monitor.options?.thresholds as Record<string, number> | undefined,
            notifyNoData: monitor.options?.notifyNoData,
            escalationMessage: monitor.options?.escalationMessage
          }
        }
      }
    }

    return enriched
  })
}

export function registerEventsTool(
  server: McpServer,
  apiV1: v1.EventsApi,
  apiV2: v2.EventsApi,
  monitorsApi: v1.MonitorsApi,
  limits: LimitsConfig,
  readOnly: boolean = false,
  site: string = 'datadoghq.com'
): void {
  server.tool(
    'events',
    `Track Datadog events. Actions: list, get, create, search, aggregate, top, timeseries, incidents.
IMPORTANT: For monitor alert history, use tags: ["source:alert"] to find all triggered monitors.
Filters: query (text search), sources, tags, priority, time range.
Use for: monitor alerts, deployments, incidents, change tracking.

Use action:"top" with from:"7d" to find the noisiest monitors.
Use action:"aggregate" with groupBy:["monitor_name"] for alert counts per monitor.
Use action:"timeseries" with interval:"1h" to see alert trends over time.
Use action:"incidents" with dedupeWindow:"5m" to deduplicate alerts into incidents.
Use enrich:true with search to get monitor metadata (slower).`,
    InputSchema,
    async ({ action, id, query, from, to, priority, sources, tags, limit, title, text, alertType, groupBy, cursor, interval, dedupeWindow, enrich }) => {
      try {
        checkReadOnly(action, readOnly)
        switch (action) {
          case 'list':
            return toolResult(await listEventsV1(apiV1, {
              query,
              from,
              to,
              priority,
              sources,
              tags,
              limit
            }, limits))

          case 'get': {
            const eventId = requireParam(id, 'id', 'get')
            return toolResult(await getEventV1(apiV1, eventId))
          }

          case 'create': {
            const eventTitle = requireParam(title, 'title', 'create')
            const eventText = requireParam(text, 'text', 'create')
            return toolResult(await createEventV1(apiV1, {
              title: eventTitle,
              text: eventText,
              priority,
              tags,
              alertType
            }))
          }

          case 'search': {
            const result = await searchEventsV2(apiV2, {
              query,
              from,
              to,
              sources,
              tags,
              priority,
              limit,
              cursor
            }, limits, site)

            // Phase 3: Optional enrichment
            if (enrich && result.events.length > 0) {
              const enrichedEvents = await enrichWithMonitorMetadata(result.events, monitorsApi)
              return toolResult({ ...result, events: enrichedEvents })
            }

            return toolResult(result)
          }

          case 'aggregate':
            return toolResult(await aggregateEventsV2(apiV2, {
              query,
              from,
              to,
              sources,
              tags,
              groupBy,
              limit
            }, limits, site))

          case 'top':
            return toolResult(await topEventsV2(apiV2, {
              query,
              from,
              to,
              sources,
              tags,
              groupBy,
              limit
            }, limits, site))

          case 'timeseries':
            return toolResult(await timeseriesEventsV2(apiV2, {
              query,
              from,
              to,
              sources,
              tags,
              groupBy,
              interval,
              limit
            }, limits, site))

          case 'incidents':
            return toolResult(await incidentsEventsV2(apiV2, {
              query,
              from,
              to,
              sources,
              tags,
              dedupeWindow,
              limit
            }, limits, site))

          default:
            throw new Error(`Unknown action: ${action}`)
        }
      } catch (error) {
        handleDatadogError(error)
      }
    }
  )
}
