import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1, v2 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import { hoursAgo, now, parseTime, ensureValidTimeRange, parseDurationToNs } from '../utils/time.js'
import { buildEventsUrl } from '../utils/urls.js'
import {
  bucketHourOfDay,
  bucketDayOfWeek,
  bucketDayOfMonth,
  validateIanaZone,
  formatLocal
} from '../utils/timezone.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum([
  'list',
  'get',
  'create',
  'search',
  'aggregate',
  'top',
  'timeseries',
  'incidents',
  'discover',
  'histogram'
])

const HistogramBucketBySchema = z.enum(['hour_of_day', 'day_of_week', 'day_of_month'])
export type HistogramBucketBy = z.infer<typeof HistogramBucketBySchema>

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z.string().optional().describe('Event ID (for get action)'),
  query: z.string().optional().describe('Search query'),
  from: z
    .string()
    .optional()
    .describe('Start time (ISO 8601, relative like "1h", or Unix timestamp)'),
  to: z.string().optional().describe('End time (ISO 8601, relative like "1h", or Unix timestamp)'),
  priority: z.enum(['normal', 'low']).optional().describe('Event priority'),
  sources: z.array(z.string()).optional().describe('Filter by sources'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  limit: z.number().min(1).optional().describe('Maximum number of events to return (default: 50)'),
  title: z.string().optional().describe('Event title (for create)'),
  text: z.string().optional().describe('Event text (for create)'),
  alertType: z
    .enum(['error', 'warning', 'info', 'success'])
    .optional()
    .describe('Alert type (for create)'),
  groupBy: z
    .array(z.string())
    .optional()
    .describe(
      'Fields to group by (for aggregate and top actions). Top: custom fields like ["service"], ["user"]. Aggregate: monitor_name, priority, alert_type, source. Default for top: ["monitor_id"]'
    ),
  cursor: z.string().optional().describe('Pagination cursor from previous response'),
  // Phase 2: Timeseries
  interval: z
    .string()
    .optional()
    .describe('Time bucket interval for timeseries: 1h, 4h, 1d (default: 1h)'),
  // Phase 2: Incidents deduplication
  dedupeWindow: z
    .string()
    .optional()
    .describe('Deduplication window for incidents: 5m, 15m, 1h (default: 5m)'),
  // Phase 3: Monitor enrichment
  enrich: z
    .boolean()
    .optional()
    .describe('Enrich events with monitor metadata (slower, adds monitor details)'),
  // Context tag extraction for top action
  contextTags: z
    .array(z.string())
    .optional()
    .describe(
      'Tag prefixes for context breakdown in top action (default: queue, service, ingress, pod_name, kube_namespace, kube_container_name)'
    ),
  maxEvents: z
    .number()
    .min(1)
    .max(5000)
    .optional()
    .describe(
      'Maximum events to fetch for grouping in top action (default: 5000, max: 5000). Higher = more accurate but slower'
    ),
  // Monitor transition filter (additive — see requirement 5.2 / monitors action=history)
  transitionType: z
    .array(
      z.enum([
        'alert',
        'alert recovery',
        'warning',
        'warning recovery',
        'no data',
        'no data recovery',
        'renotify'
      ])
    )
    .optional()
    .describe(
      'Filter events by monitor state transition type. When set, restricts results to events with @monitor.transition.transition_type matching any value. Use ["alert","alert recovery"] to count real fires/recoveries and skip renotifies. Empty array is treated as undefined (no filter). For a fires-only count by monitor ID, prefer monitors action=history.'
    ),
  // Histogram action (Requirement 3): bucket events by local hour/day-of-week/day-of-month.
  bucket_by: HistogramBucketBySchema.optional().describe(
    'Bucket dimension for histogram action: hour_of_day (0-23), day_of_week (0=Sun..6=Sat), day_of_month (1-31).'
  ),
  timezone: z
    .string()
    .optional()
    .describe(
      'Optional IANA timezone (e.g. "UTC", "Europe/Paris"). DST-safe. ' +
        'For histogram: controls hour/day bucketing (default: UTC). ' +
        'For search/aggregate/top/incidents read actions: adds sibling *Local ISO 8601 ' +
        'strings (e.g. timestampLocal) next to existing timestamps. Omit for byte-identical legacy shape.'
    )
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
  /**
   * ISO 8601 string with offset rendered in the requested IANA timezone.
   * Present ONLY when the caller passed a `timezone` parameter (Requirement 4).
   * Omitting `timezone` produces a response shape byte-identical to today.
   */
  timestampLocal?: string
}

/**
 * Annotate a single event's `timestamp` with a sibling `timestampLocal` ISO 8601
 * string in the requested IANA timezone (Requirement 4).
 *
 * Returns a shallow-copied event; the original is left untouched. Events with a
 * missing or unparseable timestamp are returned unchanged — better to surface a
 * silent skip than to crash the whole search on one bad row.
 */
function annotateEventTimezone(event: EventSummaryV2, tz: string): EventSummaryV2 {
  if (!event.timestamp) return event
  const ms = new Date(event.timestamp).getTime()
  if (!Number.isFinite(ms)) return event
  return { ...event, timestampLocal: formatLocal(ms, tz) }
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
  /**
   * ISO 8601 string with offset rendered in the requested IANA timezone.
   * Present ONLY when the caller passed a `timezone` parameter (Requirement 4).
   * Omitting `timezone` produces a response shape byte-identical to today.
   */
  timestampLocal?: string
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
  // Requirement 4: present only when caller supplied `timezone`.
  firstTriggerLocal?: string
  lastTriggerLocal?: string
  recoveredAtLocal?: string
}

// Enriched event with monitor metadata (Phase 3)
interface EnrichedEvent extends EventSummaryV2 {
  monitorMetadata?: {
    id: number
    name: string
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
export function extractMonitorInfo(title: string): {
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
  // NOSONAR S5852: Anchored pattern with no nested quantifiers, input is bounded Datadog event titles
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
export function extractTitleFromMessage(message: string): string {
  if (!message) return ''

  // Remove %%% markdown delimiter if present
  const content = message.replace(/^%%%\s*\n?/, '').trim()

  // Get first line (up to first newline)
  const firstLine = content.split('\n')[0]?.trim() ?? ''

  // Clean up common trailing patterns like " !" or extra whitespace
  // NOSONAR S5852: Simplified pattern, .trim() handles whitespace
  return firstLine.replace(/\s*!?\s*$/, '').trim()
}

/**
 * Extract monitor ID from v2 event message body
 * Messages contain links like: [[Monitor Status](/monitors/67860480?...)]
 */
export function extractMonitorIdFromMessage(message: string): number | undefined {
  if (!message) return undefined

  // Match /monitors/{id} pattern in the message
  const match = message.match(/\/monitors\/(\d+)/)
  if (match?.[1]) {
    const id = Number.parseInt(match[1], 10)
    return Number.isNaN(id) ? undefined : id
  }

  return undefined
}

/**
 * Build a group key for aggregation based on the event and groupBy fields
 */
export function buildGroupKey(event: EventSummaryV2, groupBy: string[]): string {
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
        const tagValue = event.tags.find((t) => t.startsWith(`${field}:`))?.split(':')[1] ?? ''
        parts.push(tagValue)
      }
    }
  }

  return parts.join('|')
}

export function formatEventV1(e: v1.Event): EventSummaryV1 {
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

export function formatEventV2(e: v2.EventResponse): EventSummaryV2 {
  const attrs = e.attributes ?? {}

  // Parse timestamp
  let timestamp = ''
  if (attrs.timestamp) {
    const ts = attrs.timestamp
    timestamp = ts instanceof Date ? ts.toISOString() : new Date(String(ts)).toISOString()
  }

  const message = (attrs.message as string) ?? ''

  // v2 API often returns empty title - extract from message body instead
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let title = ((attrs as any).title as string) ?? ''
  if (!title && message) {
    title = extractTitleFromMessage(message)
  }

  const monitorInfo = extractMonitorInfo(title)

  // Extract tags first (needed for monitor_id fallback)
  const tags = (attrs.tags as string[]) ?? []

  // Extract monitor_id from message URL first, then fallback to tags
  let monitorId = extractMonitorIdFromMessage(message)
  if (!monitorId) {
    const monitorIdTag = tags.find((t) => t.startsWith('monitor_id:'))
    if (monitorIdTag) {
      const parts = monitorIdTag.split(':', 2)
      const value = parts[1]
      if (value !== undefined) {
        const id = Number.parseInt(value, 10)
        monitorId = Number.isNaN(id) ? undefined : id
      }
    }
  }

  // Extract source from tags or attributes
  const sourceTag = tags.find((t) => t.startsWith('source:'))
  const source = sourceTag?.split(':')[1] ?? ''

  // Extract alert_type from tags
  const alertTypeTag = tags.find((t) => t.startsWith('alert_type:'))
  const alertType = alertTypeTag?.split(':')[1] ?? ''

  // Extract host from tags
  const hostTag = tags.find((t) => t.startsWith('host:'))
  const host = hostTag?.split(':')[1] ?? ''

  // Extract priority from tags
  const priorityTag = tags.find((t) => t.startsWith('priority:'))
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
    monitorInfo:
      monitorInfo.name !== title
        ? {
            name: monitorInfo.name,
            status: monitorInfo.status,
            scope: monitorInfo.scope,
            priority: monitorInfo.priority
          }
        : undefined
  }
}

// ============ Helper Functions for Context Tag Extraction ============

/**
 * Find the first matching context tag from event tags
 * Context tags are used to group alerts by service, queue, ingress, pod, etc.
 */
export function findFirstContextTag(tags: string[], prefixes: Set<string>): string | null {
  for (const tag of tags) {
    const colonIndex = tag.indexOf(':')
    if (colonIndex > 0) {
      const prefix = tag.substring(0, colonIndex)
      if (prefixes.has(prefix)) {
        return tag
      }
    }
  }
  return null
}

/**
 * Discover available tag prefixes in alert data
 * Useful for understanding what context tags are available before aggregating
 */
export async function discoverTagsV2(
  api: v2.EventsApi,
  params: {
    query?: string
    from?: string
    to?: string
    sources?: string[]
    tags?: string[]
  },
  limits: LimitsConfig,
  site: string
) {
  // Fetch a sample of 200 events
  const result = await searchEventsV2(
    api,
    {
      ...params,
      limit: 200
    },
    limits,
    site
  )

  // Extract unique tag prefixes
  const prefixSet = new Set<string>()
  for (const event of result.events) {
    for (const tag of event.tags) {
      if (tag.includes(':')) {
        const prefix = tag.split(':')[0]
        if (prefix) {
          prefixSet.add(prefix)
        }
      }
    }
  }

  return {
    tagPrefixes: Array.from(prefixSet).sort((a, b) => a.localeCompare(b)),
    sampleSize: result.events.length,
    meta: {
      from: result.meta.from,
      to: result.meta.to
    }
  }
}

// ============ V1 API Functions (backward compatible) ============

export async function listEventsV1(
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
  const effectiveLimit = params.limit ?? limits.defaultLimit
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
    events = events.filter(
      (e) =>
        e.title?.toLowerCase().includes(lowerQuery) || e.text?.toLowerCase().includes(lowerQuery)
    )
  }

  const result = events.slice(0, effectiveLimit).map(formatEventV1)

  return {
    events: result,
    total: events.length
  }
}

export async function getEventV1(api: v1.EventsApi, id: string) {
  const eventId = Number.parseInt(id, 10)
  if (Number.isNaN(eventId)) {
    throw new Error(`Invalid event ID: ${id}`)
  }

  const response = await api.getEvent({ eventId })
  return { event: formatEventV1(response.event ?? {}) }
}

export async function createEventV1(
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

// ============ Zero-result diagnostics for events.search ============

/**
 * Diagnostic codes attached to zero-result `events.search` responses.
 * Mirrored in `src/schema/events.ts` so agents can introspect them.
 */
export type EventsDiagnosticCode =
  | 'UNINDEXED_TAG_PREFIX'
  | 'NARROW_TIME_RANGE'
  | 'RESTRICTIVE_SOURCE_FILTER'

export interface EventsDiagnostic {
  code: EventsDiagnosticCode
  message: string
  hint?: string
}

/**
 * Seed list of tag prefixes commonly used to filter `source:alert` events that
 * Datadog does NOT index server-side. Filtering on these will silently return
 * zero results even when a matching event exists.
 *
 * Sources:
 * - Datadog event search syntax docs:
 *   https://docs.datadoghq.com/service_management/events/explorer/searching/
 * - Datadog monitor notification variables (these surface as event attributes
 *   but are not indexed as tags):
 *   https://docs.datadoghq.com/monitors/notify/variables/
 * - Project issue #49 — reported empty result sets when filtering alert events
 *   by `monitor_priority`, `notification_preset`, and similar monitor-sourced
 *   attributes.
 *
 * Keep this list narrow and conservative; false positives degrade the hint
 * quality. Update when Datadog publishes new indexing guidance.
 */
export const UNINDEXED_ALERT_TAG_PREFIXES: ReadonlyArray<string> = [
  'monitor_priority',
  'notification_preset',
  'monitor_tags',
  'alert_cycle_key',
  'monitor_group_key',
  'notification_method'
]

/**
 * Threshold below which a queried time range is flagged as narrow.
 * 5 minutes — matches the typical minimum alert evaluation window.
 */
const NARROW_TIME_RANGE_THRESHOLD_MS = 5 * 60 * 1000

/**
 * Internal: extract tag prefixes referenced in a Datadog query string and in
 * a `tags` array. Tag prefixes are the substring before the first colon, e.g.
 * `monitor_priority:P1` → `monitor_priority`.
 */
function extractTagPrefixes(query: string | undefined, tags: string[] | undefined): string[] {
  const prefixes: string[] = []

  if (query) {
    // Match bare `<word>:<value>` filters in the query. We deliberately avoid
    // a complex parser — the heuristic stays at single-token granularity.
    const re = /(?:^|\s)([a-zA-Z_][a-zA-Z0-9_]*):[^\s)]+/g
    let match: RegExpExecArray | null
    while ((match = re.exec(query)) !== null) {
      if (match[1]) {
        prefixes.push(match[1])
      }
    }
  }

  if (tags) {
    for (const tag of tags) {
      const colonIdx = tag.indexOf(':')
      if (colonIdx > 0) {
        prefixes.push(tag.slice(0, colonIdx))
      }
    }
  }

  return prefixes
}

/**
 * Internal: count the distinct query terms in a Datadog event query string,
 * excluding `source:*` filters. Used to detect a "source-only" query.
 */
function countNonSourceTerms(query: string | undefined): number {
  if (!query) return 0
  const tokens = query.split(/\s+/).filter((t) => t.length > 0 && t !== 'OR' && t !== 'AND')
  let nonSource = 0
  for (const token of tokens) {
    // Strip parentheses introduced by buildEventQuery for grouped source filters.
    const stripped = token.replace(/[()]/g, '')
    if (stripped.length === 0) continue
    if (stripped.startsWith('source:')) continue
    nonSource++
  }
  return nonSource
}

/**
 * Compute diagnostic hints for a zero-result `events.search` call.
 *
 * The heuristic is intentionally local and conservative:
 * - O(query length) string scans only — no Datadog API calls.
 * - Designed to run in under 5ms on typical query input.
 * - Returns an empty array when the query offers no actionable hint.
 *
 * Only invoked when the underlying search returned zero events.
 */
export function computeDiagnostics(input: {
  query?: string
  tags?: string[]
  sources?: string[]
  fromMs?: number
  toMs?: number
}): EventsDiagnostic[] {
  const diagnostics: EventsDiagnostic[] = []

  const query = input.query ?? ''
  const queryHasSourceAlert =
    /(^|\s|\()source:alert(\s|\)|$)/.test(query) ||
    (input.sources?.includes('alert') ?? false) ||
    (input.tags?.includes('source:alert') ?? false)

  // ----- UNINDEXED_TAG_PREFIX -----
  // Only emit on alert-source queries — that's where the known-unindexed
  // attributes apply. Other event sources have different indexing rules and
  // a false positive would be noisier than helpful.
  if (queryHasSourceAlert) {
    const prefixes = extractTagPrefixes(input.query, input.tags)
    const unindexedHits = prefixes.filter((p) => UNINDEXED_ALERT_TAG_PREFIXES.includes(p))
    const uniqueHits = Array.from(new Set(unindexedHits))
    if (uniqueHits.length > 0) {
      diagnostics.push({
        code: 'UNINDEXED_TAG_PREFIX',
        message: `Query filters on tag prefix(es) that Datadog does not index for source:alert events: ${uniqueHits.join(', ')}.`,
        hint: 'Drop these filters and post-filter the results client-side, or aggregate via monitors/get + monitors.list with matching options.'
      })
    }
  }

  // ----- NARROW_TIME_RANGE -----
  if (
    typeof input.fromMs === 'number' &&
    typeof input.toMs === 'number' &&
    input.toMs > input.fromMs &&
    input.toMs - input.fromMs < NARROW_TIME_RANGE_THRESHOLD_MS
  ) {
    diagnostics.push({
      code: 'NARROW_TIME_RANGE',
      message: 'Time range is shorter than 5 minutes; alert events may not have been indexed yet.',
      hint: 'Widen the range (e.g. last 1h) or retry after the indexing delay (~30s) has elapsed.'
    })
  }

  // ----- RESTRICTIVE_SOURCE_FILTER -----
  // Emit when the caller filtered on source:alert with no other meaningful
  // query terms (the typical anti-pattern of "give me all alerts in the last
  // 24h" returning nothing because no alerts fired).
  if (queryHasSourceAlert) {
    const otherTerms = countNonSourceTerms(input.query)
    const otherTags = (input.tags ?? []).filter((t) => !t.startsWith('source:')).length
    if (otherTerms === 0 && otherTags === 0) {
      diagnostics.push({
        code: 'RESTRICTIVE_SOURCE_FILTER',
        message:
          'Only source:alert filter was applied; the matching event set may genuinely be empty.',
        hint: 'Use events.aggregate or monitors.list to confirm no alerts fired in the window, or broaden sources (e.g. source:monitor, source:audit).'
      })
    }
  }

  return diagnostics
}

// ============ V2 API Functions (new capabilities) ============

/**
 * Quote a value for inclusion in a Datadog event search query.
 * Values containing whitespace or characters outside a small safe set are
 * wrapped in double quotes; safe single-word values stay unquoted. Mirrors the
 * helper used by `buildMonitorHistoryQuery` in `monitors.ts`.
 */
function quoteIfNeeded(value: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : `"${value}"`
}

/**
 * Build a Datadog event search query from filter parameters.
 *
 * `transitionType` is additive: when omitted or an empty array, the emitted
 * query string is byte-identical to the pre-spec behaviour (requirement 5.1).
 * When non-empty, appends `@monitor.transition.transition_type:(a OR "b c" OR ...)`
 * with multi-word values quoted, matching the live investigation in
 * design.md ("API Investigation Result").
 */
export function buildEventQuery(params: {
  query?: string
  sources?: string[]
  tags?: string[]
  priority?: string
  transitionType?: string[]
}): string {
  const parts: string[] = []

  if (params.query) {
    parts.push(params.query)
  }

  if (params.sources && params.sources.length > 0) {
    const sourceFilter = params.sources.map((s) => `source:${s}`).join(' OR ')
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

  if (params.transitionType && params.transitionType.length > 0) {
    const inner = params.transitionType.map(quoteIfNeeded).join(' OR ')
    parts.push(`@monitor.transition.transition_type:(${inner})`)
  }

  return parts.length > 0 ? parts.join(' ') : '*'
}

export async function searchEventsV2(
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
    transitionType?: string[]
    timezone?: string
  },
  limits: LimitsConfig,
  site: string
) {
  // Requirement 4: validate timezone BEFORE any Datadog call so an invalid zone
  // never burns an API request quota and surfaces a stable EINVALID_TIMEZONE.
  if (params.timezone !== undefined) {
    validateIanaZone(params.timezone)
  }

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
    priority: params.priority,
    transitionType: params.transitionType
  })

  const effectiveLimit = params.limit ?? limits.defaultLimit

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

  const rawEvents = (response.data ?? []).map(formatEventV2)
  // Requirement 4: annotate only when timezone is supplied — opt-in shape change.
  const events =
    params.timezone !== undefined
      ? rawEvents.map((e) => annotateEventTimezone(e, params.timezone as string))
      : rawEvents
  const nextCursor = response.meta?.page?.after

  const baseResult = {
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

  // Requirement 5: attach diagnostics only on zero-result responses.
  // Skip entirely on the happy path to avoid shape inflation and latency.
  if (events.length === 0) {
    const diagnostics = computeDiagnostics({
      query: params.query,
      tags: params.tags,
      sources: params.sources,
      fromMs: validFrom * 1000,
      toMs: validTo * 1000
    })
    return { ...baseResult, diagnostics }
  }

  return baseResult
}

// ============ Histogram action (Requirement 3) ============

/**
 * Output shape for the `events.histogram` action.
 *
 * `buckets` is an object map keyed by stringified bucket key (e.g. `"0".."23"`
 * for hour_of_day, `"0".."6"` for day_of_week, `"1".."31"` for day_of_month).
 * Object form chosen so JSON output is self-describing and stable across
 * runtimes — see design.md Requirement 3 / task DoD.
 */
export interface EventsHistogramOutput {
  buckets: Record<string, number>
  bucketBy: HistogramBucketBy
  timezone: string
  totalEvents: number
  bucketCountIncomplete?: boolean
  nextCursor?: string
  meta: {
    query: string
    from: string
    to: string
    datadog_url: string
  }
}

/**
 * Bucket a single event timestamp (epoch milliseconds) into the requested
 * dimension, in the requested IANA timezone.
 *
 * All zone math is delegated to `src/utils/timezone.ts`, which uses
 * `Intl.DateTimeFormat` — DST-safe by construction.
 */
function bucketEvent(epochMs: number, bucketBy: HistogramBucketBy, tz: string): number {
  switch (bucketBy) {
    case 'hour_of_day':
      return bucketHourOfDay(epochMs, tz)
    case 'day_of_week':
      return bucketDayOfWeek(epochMs, tz)
    case 'day_of_month':
      return bucketDayOfMonth(epochMs, tz)
    default: {
      // Exhaustiveness — z.enum prevents this at the input boundary, but the
      // assertion guards against future variants slipping through.
      const exhaustive: never = bucketBy
      throw new Error(`Unhandled bucket_by: ${String(exhaustive)}`)
    }
  }
}

/**
 * Convert a Datadog v2 event timestamp into epoch milliseconds.
 *
 * The v2 events SDK sometimes returns `attributes.timestamp` as an ISO 8601
 * string and sometimes as a `Date` (depending on serializer config). We accept
 * either — and silently skip any event whose timestamp cannot be parsed,
 * rather than crashing the entire histogram on a single bad row.
 */
function eventEpochMs(event: v2.EventResponse): number | null {
  const ts = event.attributes?.timestamp
  if (ts === undefined || ts === null) return null
  if (ts instanceof Date) {
    const ms = ts.getTime()
    return Number.isFinite(ms) ? ms : null
  }
  // Strings and numbers both parse via Date(); guard against NaN.
  const ms = new Date(String(ts)).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Client-side histogram for events.
 *
 * Paginates `searchEvents` with the supplied cursor (or starts fresh), bucketing
 * each event in the requested IANA timezone. Stops as soon as either:
 *  - the underlying API runs out of pages, or
 *  - we hit `limits.maxEventsForHistogram` (returning `bucketCountIncomplete: true`
 *    and the `nextCursor` so a follow-up call can resume).
 *
 * The timezone is validated up-front: an invalid zone throws `EINVALID_TIMEZONE`
 * BEFORE any Datadog request is made.
 */
export async function histogramEventsV2(
  api: v2.EventsApi,
  params: {
    query?: string
    from?: string
    to?: string
    sources?: string[]
    tags?: string[]
    bucket_by: HistogramBucketBy
    timezone?: string
    cursor?: string
  },
  limits: LimitsConfig,
  site: string
): Promise<EventsHistogramOutput> {
  const timezone = params.timezone ?? 'UTC'

  // Validate the zone BEFORE any Datadog call so an invalid zone never burns
  // an API request quota.
  validateIanaZone(timezone)

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

  const cap = limits.maxEventsForHistogram
  // Per-page limit caps at 1000 (Datadog API max). When the histogram cap is
  // smaller (e.g. tight limits in tests) honor that to avoid overshooting.
  const perPage = Math.max(1, Math.min(1000, cap))

  const buckets: Record<string, number> = {}
  let totalEvents = 0
  let cursor: string | undefined = params.cursor
  let bucketCountIncomplete = false
  let exhaustedPages = false

  // Bound pagination to avoid runaway loops even in pathological fixtures.
  const maxPages = 100
  let pageCount = 0

  while (pageCount < maxPages) {
    const body: v2.EventsListRequest = {
      filter: {
        query: fullQuery,
        from: fromTime,
        to: toTime
      },
      sort: 'timestamp' as v2.EventsSort,
      page: {
        limit: perPage,
        cursor
      }
    }

    const response = await api.searchEvents({ body })
    const data = response.data ?? []
    const responseCursor = response.meta?.page?.after ?? undefined

    for (const event of data) {
      const epochMs = eventEpochMs(event)
      if (epochMs === null) continue
      const bucket = bucketEvent(epochMs, params.bucket_by, timezone)
      const key = String(bucket)
      buckets[key] = (buckets[key] ?? 0) + 1
      totalEvents++

      if (totalEvents >= cap) {
        // Cap reached mid-page. Use the cursor from THIS response as the
        // continuation token; it points at the page boundary, not a per-event
        // offset (Datadog cursor semantics).
        bucketCountIncomplete = true
        cursor = responseCursor
        break
      }
    }

    if (bucketCountIncomplete) break

    if (data.length === 0 || !responseCursor) {
      exhaustedPages = true
      break
    }

    cursor = responseCursor
    pageCount++
  }

  const result: EventsHistogramOutput = {
    buckets,
    bucketBy: params.bucket_by,
    timezone,
    totalEvents,
    meta: {
      query: fullQuery,
      from: fromTime,
      to: toTime,
      datadog_url: buildEventsUrl(fullQuery, validFrom, validTo, site)
    }
  }

  if (bucketCountIncomplete) {
    result.bucketCountIncomplete = true
    if (cursor) {
      result.nextCursor = cursor
    }
  } else if (!exhaustedPages && pageCount >= maxPages && cursor) {
    // Defensive: page guard hit (shouldn't happen in normal flows). Surface
    // a continuation token rather than silently truncating.
    result.bucketCountIncomplete = true
    result.nextCursor = cursor
  }

  return result
}

/**
 * Client-side aggregation for events
 * Streams through all matching events and counts by group key
 */
export async function aggregateEventsV2(
  api: v2.EventsApi,
  params: {
    query?: string
    from?: string
    to?: string
    sources?: string[]
    tags?: string[]
    groupBy?: string[]
    limit?: number
    transitionType?: string[]
    timezone?: string
  },
  limits: LimitsConfig,
  site: string
) {
  // Requirement 4: validate timezone BEFORE any Datadog call.
  if (params.timezone !== undefined) {
    validateIanaZone(params.timezone)
  }

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
    tags: params.tags,
    transitionType: params.transitionType
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
    // Requirement 4: annotate sample timestamps only when timezone is supplied.
    sample:
      params.timezone !== undefined
        ? annotateEventTimezone(data.sample, params.timezone)
        : data.sample
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
 * Top N event groups with context breakdown
 * Groups events by specified fields and ranks by count with nested breakdown by context tags
 * Perfect for weekly/daily alert reports, deployment tracking, or custom event analysis
 */
export async function topEventsV2(
  api: v2.EventsApi,
  params: {
    query?: string
    from?: string
    to?: string
    sources?: string[]
    tags?: string[]
    limit?: number
    groupBy?: string[]
    contextTags?: string[]
    maxEvents?: number
    transitionType?: string[]
    timezone?: string
  },
  limits: LimitsConfig,
  site: string
) {
  // Requirement 4: validate timezone BEFORE any Datadog call. The current `top`
  // response shape exposes grouped counts and context breakdown — no per-event
  // timestamps — so annotation is a no-op on the output today; threading the
  // param ensures invalid zones still fail fast and reserves space for future
  // sample fields without a contract break.
  if (params.timezone !== undefined) {
    validateIanaZone(params.timezone)
  }

  // Validate contextTags if provided
  if (params.contextTags !== undefined) {
    if (!Array.isArray(params.contextTags)) {
      throw new Error('contextTags must be an array')
    }
    if (params.contextTags.some((tag) => typeof tag !== 'string' || tag.trim() === '')) {
      throw new Error('contextTags must be an array of non-empty strings')
    }
  }

  // Default groupBy to monitor_id for backward compatibility
  const groupByFields = params.groupBy ?? ['monitor_id']

  // Default to source:alert only if groupBy is monitor_id
  const effectiveQuery =
    params.query ?? (groupByFields.includes('monitor_id') ? 'source:alert' : '*')
  const effectiveTags =
    params.tags ?? (groupByFields.includes('monitor_id') ? ['source:alert'] : undefined)

  // Step 1: Fetch events for accurate grouping
  // maxEvents controls how many events to fetch (default 5k, max 5k per Datadog API). Higher values = more accurate
  // aggregation but slower performance. If there are more events than maxEvents, results
  // may be incomplete. Narrow time range or use filters (query, tags) if incomplete.
  const result = await searchEventsV2(
    api,
    {
      query: effectiveQuery,
      from: params.from,
      to: params.to,
      sources: params.sources,
      tags: effectiveTags,
      limit: params.maxEvents ?? 5000,
      transitionType: params.transitionType
    },
    limits,
    site
  )

  // Step 2: Group by specified fields
  type GroupValue = string | number
  const eventGroups = new Map<
    string,
    {
      groupKey: string
      groupValues: Record<string, GroupValue>
      message: string
      events: EventSummaryV2[]
    }
  >()

  for (const event of result.events) {
    // Extract values for each groupBy field
    const groupValues: Record<string, GroupValue> = {}
    const keyParts: string[] = []

    for (const field of groupByFields) {
      let value: GroupValue
      if (field === 'monitor_id') {
        value = event.monitorId ?? 0
      } else if (field === 'monitor_name') {
        value = event.monitorInfo?.name ?? event.title
      } else {
        // Extract from tags (format: field:value)
        const tag = event.tags.find((t) => t.startsWith(`${field}:`))
        value = tag ? (tag.split(':', 2)[1] ?? 'unknown') : 'unknown'
      }
      groupValues[field] = value
      keyParts.push(`${field}:${value}`)
    }

    const groupKey = keyParts.join('|')
    const message = event.monitorInfo?.name ?? event.title

    let group = eventGroups.get(groupKey)
    if (!group) {
      group = { groupKey, groupValues, message, events: [] }
      eventGroups.set(groupKey, group)
    }
    group.events.push(event)
  }

  // Step 3: For each group, extract context breakdown
  const contextPrefixes = new Set(
    params.contextTags ?? [
      'queue',
      'service',
      'ingress',
      'pod_name',
      'kube_namespace',
      'kube_container_name'
    ]
  )

  const groups = Array.from(eventGroups.values()).map((group) => {
    const contextGroups = new Map<string, number>()

    for (const event of group.events) {
      const contextTag = findFirstContextTag(event.tags, contextPrefixes)
      if (contextTag) {
        contextGroups.set(contextTag, (contextGroups.get(contextTag) || 0) + 1)
      }
    }

    const contextBreakdown = Array.from(contextGroups.entries())
      .map(([context, count]) => ({ context, count }))
      .sort((a, b) => b.count - a.count)

    // Include groups with no context tags as "no_context"
    const byContext =
      contextBreakdown.length > 0
        ? contextBreakdown
        : [{ context: 'no_context', count: group.events.length }]

    return {
      ...group.groupValues,
      message: group.message,
      total_count: group.events.length,
      by_context: byContext
    }
  })

  // Step 4: Sort by total_count, apply limit, add rank
  const topGroups = groups
    .sort((a, b) => b.total_count - a.total_count)
    .slice(0, params.limit ?? 10)
    .map((g, i) => ({ rank: i + 1, ...g }))

  return {
    top: topGroups,
    meta: {
      query: effectiveQuery,
      from: result.meta.from,
      to: result.meta.to,
      groupBy: groupByFields,
      totalGroups: eventGroups.size,
      totalEvents: result.events.length,
      contextPrefixes: Array.from(contextPrefixes),
      datadog_url: result.meta.datadog_url
    }
  }
}

// ============ Phase 2: Timeseries Action ============

/**
 * Parse interval string to milliseconds
 * Supports: 1h, 4h, 1d, 15m, etc.
 */
export function parseIntervalToMs(interval: string | undefined): number {
  const ns = parseDurationToNs(interval ?? '1h')
  return ns ? Math.floor(ns / 1000000) : 3600000 // default 1h
}

/**
 * Time-bucketed alert trends
 * Buckets events by time interval and groups by specified fields
 */
export async function timeseriesEventsV2(
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
    transitionType?: string[]
    timezone?: string
  },
  limits: LimitsConfig,
  site: string
) {
  // Requirement 4: validate timezone BEFORE any Datadog call so an invalid zone
  // never burns an API request quota and surfaces a stable EINVALID_TIMEZONE.
  if (params.timezone !== undefined) {
    validateIanaZone(params.timezone)
  }

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
    tags: params.tags,
    transitionType: params.transitionType
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
  const tz = params.timezone
  const sortedBuckets = [...timeBuckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucketTs, groupCounts]) => {
      const counts: Record<string, number> = {}
      let total = 0
      for (const [key, count] of groupCounts) {
        counts[key] = count
        total += count
      }
      const bucket: TimeseriesBucket = {
        timestamp: new Date(bucketTs).toISOString(),
        timestampMs: bucketTs,
        counts,
        total
      }
      // Requirement 4: annotate bucket timestamps with a sibling timestampLocal
      // ONLY when the caller supplied a timezone — preserves byte-identical legacy shape.
      if (tz !== undefined) {
        bucket.timestampLocal = formatLocal(bucketTs, tz)
      }
      return bucket
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
export async function incidentsEventsV2(
  api: v2.EventsApi,
  params: {
    query?: string
    from?: string
    to?: string
    sources?: string[]
    tags?: string[]
    dedupeWindow?: string
    limit?: number
    transitionType?: string[]
    timezone?: string
  },
  limits: LimitsConfig,
  site: string
) {
  // Requirement 4: validate timezone BEFORE any Datadog call.
  if (params.timezone !== undefined) {
    validateIanaZone(params.timezone)
  }

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
    tags: params.tags,
    transitionType: params.transitionType
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
        if (
          msgLower.includes('recovered') ||
          msgLower.includes('[ok]') ||
          msgLower.includes('resolved')
        ) {
          status = 'recovered'
        } else {
          status = 'triggered'
        }
      }

      const existing = incidents.get(monitorName)

      if (
        status === 'triggered' ||
        status === 'alert' ||
        status === 're-triggered' ||
        status === 'renotify'
      ) {
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
  const tz = params.timezone
  const incidentList: IncidentEvent[] = [...incidents.values()].map((inc) => {
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

    const base: IncidentEvent = {
      monitorName: inc.monitorName,
      firstTrigger: inc.firstTrigger.toISOString(),
      lastTrigger: inc.lastTrigger.toISOString(),
      triggerCount: inc.triggerCount,
      recovered: inc.recovered,
      recoveredAt: inc.recoveredAt?.toISOString(),
      duration,
      // Requirement 4: annotate the nested sample event timestamp when tz is supplied.
      sample: tz !== undefined ? annotateEventTimezone(inc.sample, tz) : inc.sample
    }

    // Requirement 4: opt-in sibling *Local strings for trigger/recovery timestamps.
    if (tz !== undefined) {
      base.firstTriggerLocal = formatLocal(inc.firstTrigger.getTime(), tz)
      base.lastTriggerLocal = formatLocal(inc.lastTrigger.getTime(), tz)
      if (inc.recoveredAt) {
        base.recoveredAtLocal = formatLocal(inc.recoveredAt.getTime(), tz)
      }
    }

    return base
  })

  // Sort by first trigger descending, apply limit
  incidentList.sort(
    (a, b) => new Date(b.firstTrigger).getTime() - new Date(a.firstTrigger).getTime()
  )
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
      recoveredCount: incidentList.filter((i) => i.recovered).length,
      activeCount: incidentList.filter((i) => !i.recovered).length,
      truncated: eventCount >= maxEventsToProcess,
      datadog_url: buildEventsUrl(fullQuery, validFrom, validTo, site)
    }
  }
}

// ============ Phase 3: Monitor Metadata Enrichment ============

/**
 * Enrich events with monitor metadata from the Monitors API
 */
export async function enrichWithMonitorMetadata(
  events: EventSummaryV2[],
  monitorsApi: v1.MonitorsApi
): Promise<EnrichedEvent[]> {
  // Extract unique monitor IDs
  const monitorIds = new Set<number>()
  for (const event of events) {
    if (event.monitorId) {
      monitorIds.add(event.monitorId)
    }
  }

  if (monitorIds.size === 0) {
    return events as EnrichedEvent[]
  }

  // Fetch all monitors and filter by ID
  // Note: The TypeScript client doesn't support monitorIds parameter
  // so we fetch all and filter in memory
  const monitorCache = new Map<number, v1.Monitor>()

  try {
    const response = await monitorsApi.listMonitors({
      pageSize: 1000
    })

    const monitors = response ?? []
    // Filter to only the monitors we need
    for (const monitor of monitors) {
      if (monitor.id && monitorIds.has(monitor.id)) {
        monitorCache.set(monitor.id, monitor)
      }
    }
  } catch {
    // If monitor fetch fails, return events without enrichment
    return events as EnrichedEvent[]
  }

  // Enrich events
  return events.map((event) => {
    const enriched: EnrichedEvent = { ...event }

    if (event.monitorId) {
      const monitor = monitorCache.get(event.monitorId)
      if (monitor) {
        enriched.monitorMetadata = {
          id: monitor.id ?? 0,
          name: monitor.name ?? '',
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
    `Track Datadog events. Actions: list, get, create, search, aggregate, top, timeseries, incidents, discover, histogram.
For monitor alerts, use tags: ["source:alert"].

IMPORTANT — re-evaluation vs transition:
  - source:alert events INCLUDE renotifies and re-evaluations (every Datadog re-evaluation of an alerting monitor emits an event). A "how many times did monitor X fire" question answered with source:alert alone over-counts.
  - To restrict to real state transitions, pass transitionType (e.g. ["alert","alert recovery"]). This appends @monitor.transition.transition_type:(...) to the query and matches the design's live investigation.
  - For a fires-only numeric count rooted in a single monitor ID, prefer the higher-level primitive monitors action=history — it returns {transitions, count, meta} with the same filter applied for you.

transitionType: Optional array of monitor transition types (alert, alert recovery, warning, warning recovery, no data, no data recovery, renotify). Empty array is treated as undefined.
top: Generic event grouping by any fields (groupBy parameter). Returns groups ranked by count with optional context breakdown.
  - Example: {groupBy: ["service"], message: "...", service: "api", total_count: 50, by_context: [{context: "queue:X", count: 30}]}
  - Use for deployments, configs, custom events, or monitor alerts
  - Returns "message" field (event title), NOT monitor name (use monitors tool for real names)
  - total_count includes renotifies when source:alert is used without transitionType — see monitors action=history for fires-only counts
discover: Returns available tag prefixes from events.
aggregate: Custom groupBy, returns pipe-delimited keys.
search: Full event details.
timeseries: Time-bucketed trends with interval.
incidents: Deduplicate alerts with dedupeWindow.
histogram: Bucket events by local hour_of_day / day_of_week / day_of_month in the requested IANA timezone (DST-safe). Pass bucket_by (required) and optional timezone (default UTC) and cursor (for continuation). Caps at limits.maxEventsForHistogram (default 5000); when reached returns bucketCountIncomplete:true + nextCursor.`,
    InputSchema,
    async ({
      action,
      id,
      query,
      from,
      to,
      priority,
      sources,
      tags,
      limit,
      title,
      text,
      alertType,
      groupBy,
      cursor,
      interval,
      dedupeWindow,
      enrich,
      contextTags,
      maxEvents,
      transitionType,
      bucket_by,
      timezone
    }) => {
      try {
        checkReadOnly(action, readOnly)
        switch (action) {
          case 'list':
            return toolResult(
              await listEventsV1(
                apiV1,
                {
                  query,
                  from,
                  to,
                  priority,
                  sources,
                  tags,
                  limit
                },
                limits
              )
            )

          case 'get': {
            const eventId = requireParam(id, 'id', 'get')
            return toolResult(await getEventV1(apiV1, eventId))
          }

          case 'create': {
            const eventTitle = requireParam(title, 'title', 'create')
            const eventText = requireParam(text, 'text', 'create')
            return toolResult(
              await createEventV1(apiV1, {
                title: eventTitle,
                text: eventText,
                priority,
                tags,
                alertType
              })
            )
          }

          case 'search': {
            const result = await searchEventsV2(
              apiV2,
              {
                query,
                from,
                to,
                sources,
                tags,
                priority,
                limit,
                cursor,
                transitionType,
                timezone
              },
              limits,
              site
            )

            // Phase 3: Optional enrichment
            if (enrich && result.events.length > 0) {
              const enrichedEvents = await enrichWithMonitorMetadata(result.events, monitorsApi)
              return toolResult({ ...result, events: enrichedEvents })
            }

            return toolResult(result)
          }

          case 'aggregate':
            return toolResult(
              await aggregateEventsV2(
                apiV2,
                {
                  query,
                  from,
                  to,
                  sources,
                  tags,
                  groupBy,
                  limit,
                  transitionType,
                  timezone
                },
                limits,
                site
              )
            )

          case 'top':
            return toolResult(
              await topEventsV2(
                apiV2,
                {
                  query,
                  from,
                  to,
                  sources,
                  tags,
                  limit,
                  groupBy,
                  contextTags,
                  maxEvents,
                  transitionType,
                  timezone
                },
                limits,
                site
              )
            )

          case 'discover':
            return toolResult(
              await discoverTagsV2(
                apiV2,
                {
                  query,
                  from,
                  to,
                  sources,
                  tags
                },
                limits,
                site
              )
            )

          case 'timeseries':
            return toolResult(
              await timeseriesEventsV2(
                apiV2,
                {
                  query,
                  from,
                  to,
                  sources,
                  tags,
                  groupBy,
                  interval,
                  limit,
                  transitionType,
                  timezone
                },
                limits,
                site
              )
            )

          case 'incidents':
            return toolResult(
              await incidentsEventsV2(
                apiV2,
                {
                  query,
                  from,
                  to,
                  sources,
                  tags,
                  dedupeWindow,
                  limit,
                  transitionType,
                  timezone
                },
                limits,
                site
              )
            )

          case 'histogram': {
            const histogramBucketBy = requireParam(bucket_by, 'bucket_by', 'histogram')
            return toolResult(
              await histogramEventsV2(
                apiV2,
                {
                  query,
                  from,
                  to,
                  sources,
                  tags,
                  bucket_by: histogramBucketBy,
                  timezone,
                  cursor
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
