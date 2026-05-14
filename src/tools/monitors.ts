import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v1, v2 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import { buildMonitorUrl, buildMonitorsListUrl } from '../utils/urls.js'
import { hoursAgo, now, parseTime, ensureValidTimeRange } from '../utils/time.js'
import { buildEventsUrl } from '../utils/urls.js'
import { formatEventV2 } from './events.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum([
  'list',
  'get',
  'search',
  'create',
  'update',
  'delete',
  'mute',
  'unmute',
  'top',
  'history'
])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z.string().optional().describe('Monitor ID (required for get/update/delete/mute/unmute)'),
  query: z.string().optional().describe('Search query (for search action)'),
  name: z.string().optional().describe('Filter by name (for list action)'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  groupStates: z
    .array(z.string())
    .optional()
    .describe(
      'Filter multi-alert monitors by group states (e.g., alert by host). Does NOT filter by overall monitor status. Values: alert, warn, no data, ok'
    ),
  limit: z
    .number()
    .min(1)
    .optional()
    .describe('Maximum number of monitors to return (default: 50)'),
  config: z.record(z.unknown()).optional().describe('Monitor configuration (for create/update)'),
  message: z.string().optional().describe('Mute message (for mute action)'),
  end: z.number().optional().describe('Mute end timestamp (for mute action)'),
  // Top action parameters
  from: z
    .string()
    .optional()
    .describe('Start time (ISO 8601, relative like "1h", or Unix timestamp)'),
  to: z.string().optional().describe('End time (ISO 8601, relative like "1h", or Unix timestamp)'),
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
    .describe('Maximum events to fetch for top action (default: 5000, max: 5000)'),
  // History action parameters
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
      'For history action: filter by monitor state transition types. Default: ["alert","alert recovery"] (real fires + recoveries, excludes renotifies). Pass ["alert"] for fires only, or include "renotify" for full chronological audit.'
    ),
  group: z
    .string()
    .optional()
    .describe(
      'For history action: filter transitions to a specific multi-alert monitor group (e.g., "pod_name:foo,kube_namespace:bar"). Optional; omit for all groups.'
    ),
  dry_run: z
    .boolean()
    .optional()
    .describe(
      'When create + dry_run=true, validate the monitor body via POST /api/v1/monitor/validate ' +
        'without creating it. Allowed under --read-only because no monitor is created. ' +
        'Returns { valid, dryRun, monitor }. 400 responses surface verbatim like a failed create.'
    )
}

// Nested schemas for MonitorOptionsSchema (see design.md Data model).
// Each uses .passthrough() so unknown sub-keys are forwarded to Datadog unchanged.
// Exported so they can be composed by MonitorOptionsSchema (Task 2) and asserted
// by unit tests (Task 9) without changing module-local visibility later.
// Thresholds — values are all documented as numbers in Datadog Monitor API
export const MonitorThresholdsSchema = z
  .object({
    critical: z.number().optional(),
    warning: z.number().optional(),
    ok: z.number().optional(),
    criticalRecovery: z.number().optional(),
    warningRecovery: z.number().optional(),
    unknown: z.number().optional()
  })
  .passthrough()

// Threshold windows for anomaly / forecast monitors
export const MonitorThresholdWindowsSchema = z
  .object({
    triggerWindow: z.string().optional(),
    recoveryWindow: z.string().optional()
  })
  .passthrough()

// Scheduling options (e.g., evaluation_window for SLO-driven monitors)
export const SchedulingOptionsSchema = z
  .object({
    evaluationWindow: z.record(z.unknown()).optional(),
    customSchedule: z.record(z.unknown()).optional()
  })
  .passthrough()

// Validated schema for `config.options.*` keys (see design.md Data model).
// Each documented Datadog Monitor options key is typed; nullable keys
// (`renotifyInterval`, `timeoutH`, `silenced` values) follow Datadog docs.
// `.passthrough()` preserves unknown keys so callers can use newly-shipped
// Datadog options before this schema enumerates them; `collectUnknownKeyWarnings`
// (Task 5) emits warnings for those keys.
export const MonitorOptionsSchema = z
  .object({
    // Notification
    notifyNoData: z.boolean().optional(),
    noDataTimeframe: z.number().optional(),
    notifyAudit: z.boolean().optional(),
    notificationPresetName: z.string().optional(),
    // Evaluation / delay
    newHostDelay: z.number().optional(),
    newGroupDelay: z.number().optional(),
    evaluationDelay: z.number().optional(),
    requireFullWindow: z.boolean().optional(),
    onMissingData: z.string().optional(),
    // Renotification
    renotifyInterval: z.number().nullable().optional(),
    renotifyOccurrences: z.number().optional(),
    renotifyStatuses: z.array(z.string()).optional(),
    escalationMessage: z.string().optional(),
    // Lifecycle
    timeoutH: z.number().nullable().optional(),
    includeTags: z.boolean().optional(),
    locked: z.boolean().optional(),
    silenced: z.record(z.number().nullable()).optional(),
    groupRetentionDuration: z.string().optional(),
    // Thresholds & scheduling
    thresholds: MonitorThresholdsSchema.optional(),
    thresholdWindows: MonitorThresholdWindowsSchema.optional(),
    schedulingOptions: SchedulingOptionsSchema.optional()
  })
  .passthrough()

// Validated schema for top-level `config` keys (see design.md Data model).
// Eight documented top-level keys are enumerated; `options` composes
// `MonitorOptionsSchema`. `priority` is constrained to integers 1–5 per
// Datadog's documented priority range (Requirement 2.4); `.nullable()`
// allows callers to clear it on update. `.passthrough()` preserves unknown
// top-level keys; `collectUnknownKeyWarnings` (Task 5) emits warnings for
// those keys.
export const MonitorConfigSchema = z
  .object({
    name: z.string().optional(),
    type: z.string().optional(),
    query: z.string().optional(),
    message: z.string().optional(),
    tags: z.array(z.string()).optional(),
    priority: z.number().int().min(1).max(5).nullable().optional(),
    restrictedRoles: z.array(z.string()).nullable().optional(),
    multi: z.boolean().optional(),
    options: MonitorOptionsSchema.optional()
  })
  .passthrough()

export type MonitorConfigInput = z.infer<typeof MonitorConfigSchema>

// Known-key sets derived from the schema shapes — single source of truth
// (see design.md "Risks and trade-offs" → "Deriving KNOWN_*_KEYS from
// Object.keys(schema.shape) rather than hand-maintaining a parallel list").
// DO NOT refactor these to hand-maintained literals: drift between the
// schemas and the warning logic (Task 5) would re-introduce the silent
// pass-through bug this spec is fixing. Used by `collectUnknownKeyWarnings`
// to diff caller input against the validated key set.
// `options` is excluded from KNOWN_TOP_LEVEL_KEYS because it is a known
// nested holder (validated via MonitorOptionsSchema) — flagging it as an
// unknown top-level key would emit a spurious warning whenever a caller
// supplies any nested options.
export const KNOWN_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(
  Object.keys(MonitorConfigSchema.shape).filter((key) => key !== 'options')
)

export const KNOWN_OPTIONS_KEYS: ReadonlySet<string> = new Set(
  Object.keys(MonitorOptionsSchema.shape)
)

/**
 * Collect human-readable warnings for any keys in `config` (or `config.options`)
 * that the validated schema does not enumerate. Pure function — operates on the
 * already-normalized (post-`normalizeMonitorConfig`, camelCase) config so that
 * documented snake_case aliases do NOT appear as unknown.
 *
 * Ordering (Requirement 4.4): top-level unknowns first, then options unknowns;
 * within each group, the caller's insertion order is preserved so that log
 * diffing is deterministic.
 *
 * Robustness: `config.options` being absent, `null`, a non-object, or an array
 * is tolerated silently — the nested scan is simply skipped. This mirrors the
 * normalizer's lenient handling and avoids throwing before schema validation
 * has a chance to surface a better error.
 *
 * @param config Normalized monitor config (output of `normalizeMonitorConfig`).
 * @returns Stable-ordered warnings; empty array when all keys are recognised.
 */
export function collectUnknownKeyWarnings(config: Record<string, unknown>): string[] {
  const warnings: string[] = []

  for (const key of Object.keys(config)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key) && key !== 'options') {
      warnings.push(`unknown top-level key '${key}' under config forwarded without validation`)
    }
  }

  const options = config.options
  if (isPlainObject(options)) {
    for (const key of Object.keys(options)) {
      if (!KNOWN_OPTIONS_KEYS.has(key)) {
        warnings.push(
          `unknown option key '${key}' under config.options forwarded without validation`
        )
      }
    }
  }

  return warnings
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Summarize the FIRST issue from a `ZodError` into a single-line string for
 * the `EINVALID_MONITOR_CONFIG:` error message (design.md "Error handling" →
 * row 1). Includes the dotted key path and the expected type so callers can
 * locate and fix the wrong-type value without parsing the full ZodError.
 */
function summarizeZodIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) {
    return 'validation failed'
  }
  const path = issue.path.length > 0 ? issue.path.join('.') : '<root>'
  // `z.ZodInvalidTypeIssue` carries an `expected` field; other issue codes
  // (out-of-range, etc.) do not. Fall back to the issue `message` so callers
  // still see a useful hint (e.g., "Number must be less than or equal to 5").
  const expected =
    issue.code === 'invalid_type' && 'expected' in issue
      ? `expected ${String(issue.expected)}`
      : issue.message
  return `${path}: ${expected}`
}

interface MonitorSummary {
  id: number
  name: string
  type: string
  status: string
  message: string
  tags: string[]
  query: string
  created: string
  modified: string
  url: string
}

export function formatMonitor(m: v1.Monitor, site: string = 'datadoghq.com'): MonitorSummary {
  const monitorId = m.id ?? 0
  return {
    id: monitorId,
    name: m.name ?? '',
    type: String(m.type ?? 'unknown'),
    status: String(m.overallState ?? 'unknown'),
    message: m.message ?? '',
    tags: m.tags ?? [],
    query: m.query ?? '',
    created: m.created ? new Date(m.created).toISOString() : '',
    modified: m.modified ? new Date(m.modified).toISOString() : '',
    url: buildMonitorUrl(monitorId, site)
  }
}

export interface MonitorDetail extends MonitorSummary {
  options?: v1.MonitorOptions
  multi?: boolean
  priority?: number
  restrictedRoles?: string[]
}

export function formatMonitorDetail(m: v1.Monitor, site: string = 'datadoghq.com'): MonitorDetail {
  const detail: MonitorDetail = { ...formatMonitor(m, site) }
  if (m.options != null) {
    detail.options = m.options
  }
  if (m.multi != null) {
    detail.multi = m.multi
  }
  if (m.priority != null) {
    detail.priority = m.priority
  }
  if (m.restrictedRoles != null) {
    detail.restrictedRoles = m.restrictedRoles
  }
  return detail
}

// ============ Monitor State History (action=history) types and helpers ============

/**
 * Monitor transition types as exposed by Datadog's
 * `@monitor.transition.transition_type` facet on v2 events.
 *
 * - 'alert' / 'warning' / 'no data' are forward transitions (OK/Warn → Alert, etc.)
 * - '<state> recovery' transitions are returns to OK
 * - 'renotify' is a repeated notification while the monitor is stuck in a non-OK
 *   state — it is NOT a state transition and is excluded by default.
 */
export type TransitionType =
  | 'alert'
  | 'alert recovery'
  | 'warning'
  | 'warning recovery'
  | 'no data'
  | 'no data recovery'
  | 'renotify'

/** Datadog monitor state values used in `source_state` / `destination_state`. */
export type MonitorState = 'Alert' | 'Warn' | 'OK' | 'No Data'

/** A single state transition extracted from a v2 events `source:alert` payload. */
export interface MonitorTransition {
  /** ISO 8601 timestamp of the transition. */
  timestamp: string
  monitorId: number
  monitorName: string
  /** Joined `monitor.groups` array (comma-separated) or `null` when not multi-alert. */
  group: string | null
  fromState: MonitorState
  toState: MonitorState
  transitionType: TransitionType
  /** Event ID for cross-reference with the events tool. */
  eventId: string
}

/** Metadata describing the request and post-filter shape of a history call. */
export interface MonitorHistoryMeta {
  monitorId: number
  query: string
  from: string
  to: string
  transitionTypes: TransitionType[]
  group: string | null
  count: number
  totalFetched: number
  truncated: boolean
  datadog_url: string
}

/** Full response shape for `monitors action=history`. */
export interface MonitorHistoryResponse {
  transitions: MonitorTransition[]
  count: number
  meta: MonitorHistoryMeta
}

/** Default transition_type filter applied by `monitors action=history`. */
export const DEFAULT_HISTORY_TRANSITION_TYPES: readonly TransitionType[] = [
  'alert',
  'alert recovery'
]

/**
 * Quote a value for inclusion in a Datadog event search query.
 * Multi-word values (containing whitespace) and values containing characters
 * other than a small safe set get wrapped in double quotes; single-word safe
 * values stay unquoted to match the verbatim shape observed in the live
 * investigation (see design.md "Investigation log").
 */
function quoteIfNeeded(value: string): string {
  // Safe = letters, digits, underscore, hyphen, dot — Datadog accepts these unquoted.
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : `"${value}"`
}

/**
 * Compose the Datadog event search `filter.query` for `monitors action=history`.
 *
 * Always emits `source:alert @monitor.id:N`. When `transitionType` is a non-empty
 * array, appends `@monitor.transition.transition_type:(a OR "b c" OR ...)` with
 * multi-word values quoted. When `group` is non-empty, appends
 * `@monitor.groups:"<group>"`.
 *
 * An empty `transitionType: []` is treated as undefined per design (no clause).
 */
export function buildMonitorHistoryQuery(params: {
  monitorId: number
  transitionType?: TransitionType[]
  group?: string
}): string {
  const parts: string[] = ['source:alert', `@monitor.id:${params.monitorId}`]

  const transitionTypes =
    params.transitionType && params.transitionType.length > 0 ? params.transitionType : undefined

  if (transitionTypes) {
    const inner = transitionTypes.map(quoteIfNeeded).join(' OR ')
    parts.push(`@monitor.transition.transition_type:(${inner})`)
  }

  if (params.group && params.group.length > 0) {
    const escaped = params.group.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    parts.push(`@monitor.groups:"${escaped}"`)
  }

  return parts.join(' ')
}

/**
 * Shape of the `monitor.transition` block as observed in v2 event responses.
 * The SDK's ObjectSerializer moves unknown keys (like `transition`) into
 * `monitor.additionalProperties` because `transition` is not declared on the
 * generated `MonitorType` model. Synthetic test events constructed in unit
 * tests, on the other hand, keep `transition` directly on the monitor object.
 * We support both shapes via the `additionalProperties` fallback in
 * `formatMonitorTransition`.
 */
interface RawMonitorTransition {
  source_state?: string
  destination_state?: string
  transition_type?: string
}

interface RawMonitorBlock {
  id?: number
  name?: string
  groups?: unknown
  transition?: RawMonitorTransition
  additionalProperties?: { transition?: RawMonitorTransition }
}

function isMonitorState(value: unknown): value is MonitorState {
  return value === 'Alert' || value === 'Warn' || value === 'OK' || value === 'No Data'
}

function isTransitionType(value: unknown): value is TransitionType {
  return (
    value === 'alert' ||
    value === 'alert recovery' ||
    value === 'warning' ||
    value === 'warning recovery' ||
    value === 'no data' ||
    value === 'no data recovery' ||
    value === 'renotify'
  )
}

function extractTimestamp(outer: { timestamp?: unknown }, inner: { timestamp?: unknown }): string {
  const outerTs = outer.timestamp
  if (outerTs instanceof Date) {
    return outerTs.toISOString()
  }
  if (typeof outerTs === 'string' && outerTs.length > 0) {
    const d = new Date(outerTs)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  const innerTs = inner.timestamp
  if (typeof innerTs === 'number' && Number.isFinite(innerTs)) {
    return new Date(innerTs).toISOString()
  }
  if (typeof innerTs === 'string' && innerTs.length > 0) {
    const parsed = Number.parseInt(innerTs, 10)
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString()
    }
  }
  return ''
}

/**
 * Project a raw v2 `EventResponse` to a typed `MonitorTransition`.
 *
 * Returns `null` when the event lacks an `attributes.attributes.monitor.transition`
 * block — for example renotify rows that slip past a stale filter, or non-monitor
 * events. The caller is expected to drop nulls before counting.
 */
export function formatMonitorTransition(event: v2.EventResponse): MonitorTransition | null {
  const outer = (event.attributes ?? {}) as { timestamp?: unknown; attributes?: unknown }
  const inner = (outer.attributes ?? {}) as {
    timestamp?: unknown
    monitor?: unknown
  }
  const monitor = inner.monitor as RawMonitorBlock | undefined
  if (!monitor) {
    return null
  }
  // After SDK deserialization, unknown keys land in `monitor.additionalProperties`
  // (see ObjectSerializer behaviour in node_modules/@datadog/datadog-api-client/
  //  packages/datadog-api-client-v2/models/ObjectSerializer.js). Fall back to
  //  that location so live API responses parse correctly while synthetic test
  //  events keep working unchanged.
  const transition = monitor.transition ?? monitor.additionalProperties?.transition
  if (!transition) {
    return null
  }

  const fromState = isMonitorState(transition.source_state) ? transition.source_state : null
  const toState = isMonitorState(transition.destination_state) ? transition.destination_state : null
  const transitionType = isTransitionType(transition.transition_type)
    ? transition.transition_type
    : null

  if (!fromState || !toState || !transitionType) {
    return null
  }

  const groupsRaw = monitor.groups
  const group =
    Array.isArray(groupsRaw) && groupsRaw.length > 0
      ? groupsRaw.map((g) => String(g)).join(',')
      : null

  const monitorId = typeof monitor.id === 'number' ? monitor.id : 0
  const monitorName =
    typeof monitor.name === 'string' && monitor.name.length > 0
      ? monitor.name
      : `Monitor ${monitorId}`

  return {
    timestamp: extractTimestamp(outer, inner),
    monitorId,
    monitorName,
    group,
    fromState,
    toState,
    transitionType,
    eventId: String(event.id ?? '')
  }
}

/**
 * Orchestrate a `monitors action=history` query: paginate `eventsApi.searchEvents`,
 * project each raw event via `formatMonitorTransition`, and return the structured
 * `MonitorHistoryResponse`.
 *
 * Defaults follow the conventions of other event-based actions in this codebase:
 * - Time range falls back to `hoursAgo(limits.defaultTimeRangeHours)` → `now()`.
 * - `transitionType` defaults to `DEFAULT_HISTORY_TRANSITION_TYPES`
 *   (`['alert', 'alert recovery']`) when undefined OR empty.
 *
 * Pagination is bounded identically to `aggregateEventsV2`:
 * - `maxPages = 100`
 * - `maxEventsToProcess = 10000`
 * - per-page `limit = 1000`
 *
 * On cap hit, `meta.truncated` is set to `true`. The function is strictly
 * read-only: it never calls any SDK method whose verb is
 * `create`/`update`/`delete`/`mute`/`unmute`.
 */
export async function historyMonitor(
  eventsApi: v2.EventsApi,
  monitorId: number,
  params: {
    from?: string
    to?: string
    transitionType?: TransitionType[]
    group?: string
  },
  limits: LimitsConfig,
  site: string
): Promise<MonitorHistoryResponse> {
  // Time range setup — identical convention to topMonitors / searchEventsV2.
  const defaultFrom = hoursAgo(limits.defaultTimeRangeHours)
  const defaultTo = now()
  const [validFrom, validTo] = ensureValidTimeRange(
    parseTime(params.from, defaultFrom),
    parseTime(params.to, defaultTo)
  )
  const fromTime = new Date(validFrom * 1000).toISOString()
  const toTime = new Date(validTo * 1000).toISOString()

  // Empty array → undefined → default per design's error-handling table.
  const effectiveTransitionTypes: TransitionType[] =
    params.transitionType && params.transitionType.length > 0
      ? params.transitionType
      : [...DEFAULT_HISTORY_TRANSITION_TYPES]

  const query = buildMonitorHistoryQuery({
    monitorId,
    transitionType: effectiveTransitionTypes,
    group: params.group
  })

  const transitions: MonitorTransition[] = []
  const maxEventsToProcess = 10000
  const maxPages = 100
  let eventCount = 0
  let pageCount = 0

  const body: v2.EventsListRequest = {
    filter: {
      query,
      from: fromTime,
      to: toTime
    },
    sort: 'timestamp' as v2.EventsSort,
    page: { limit: 1000 }
  }

  let cursor: string | undefined

  while (pageCount < maxPages && eventCount < maxEventsToProcess) {
    const pageBody = { ...body, page: { ...body.page, cursor } }
    const response = await eventsApi.searchEvents({ body: pageBody })

    const events = response.data ?? []
    if (events.length === 0) break

    for (const event of events) {
      const transition = formatMonitorTransition(event)
      if (transition !== null) {
        transitions.push(transition)
      }
      eventCount++
      if (eventCount >= maxEventsToProcess) break
    }

    cursor = response.meta?.page?.after
    if (!cursor) break
    pageCount++
  }

  const truncated = eventCount >= maxEventsToProcess
  const resolvedGroup = params.group && params.group.length > 0 ? params.group : null
  const count = transitions.length

  const meta: MonitorHistoryMeta = {
    monitorId,
    query,
    from: fromTime,
    to: toTime,
    transitionTypes: effectiveTransitionTypes,
    group: resolvedGroup,
    count,
    totalFetched: eventCount,
    truncated,
    datadog_url: buildEventsUrl(query, validFrom, validTo, site)
  }

  return {
    transitions,
    count,
    meta
  }
}

export async function listMonitors(
  api: v1.MonitorsApi,
  params: { name?: string; tags?: string[]; groupStates?: string[]; limit?: number },
  limits: LimitsConfig,
  site: string
) {
  const effectiveLimit = params.limit ?? limits.defaultLimit

  const response = await api.listMonitors({
    name: params.name,
    tags: params.tags?.join(','),
    groupStates: params.groupStates?.join(',')
  })

  const monitors = response.slice(0, effectiveLimit).map((m) => formatMonitor(m, site))

  const statusCounts = {
    total: response.length,
    alert: response.filter((m) => m.overallState === 'Alert').length,
    warn: response.filter((m) => m.overallState === 'Warn').length,
    ok: response.filter((m) => m.overallState === 'OK').length,
    noData: response.filter((m) => m.overallState === 'No Data').length
  }

  return {
    monitors,
    summary: statusCounts,
    datadog_url: buildMonitorsListUrl(
      { name: params.name, tags: params.tags, groupStates: params.groupStates },
      site
    )
  }
}

export async function getMonitor(api: v1.MonitorsApi, id: string, site: string) {
  const monitorId = Number.parseInt(id, 10)
  if (Number.isNaN(monitorId)) {
    throw new Error(`Invalid monitor ID: ${id}`)
  }

  const monitor = await api.getMonitor({ monitorId })
  return {
    monitor: formatMonitorDetail(monitor, site),
    datadog_url: buildMonitorUrl(monitorId, site)
  }
}

export async function searchMonitors(
  api: v1.MonitorsApi,
  query: string,
  limits: LimitsConfig,
  site: string
) {
  const response = await api.searchMonitors({ query })
  const monitors = (response.monitors ?? []).map((m) => ({
    id: m.id ?? 0,
    name: m.name ?? '',
    status: String(m.status ?? 'unknown'),
    type: m.type ?? '',
    tags: m.tags ?? [],
    url: buildMonitorUrl(m.id ?? 0, site)
  }))

  return {
    monitors,
    metadata: {
      totalCount: response.metadata?.totalCount ?? monitors.length,
      pageCount: response.metadata?.pageCount ?? 1,
      page: response.metadata?.page ?? 0
    },
    datadog_url: buildMonitorsListUrl({ name: query }, site)
  }
}

/**
 * Normalize monitor config to handle snake_case -> camelCase conversion
 * Common fields that users might pass in snake_case
 */
export function normalizeMonitorConfig(
  config: Record<string, unknown>,
  isUpdate: boolean = false
): Record<string, unknown> {
  const normalized = { ...config }

  // Required field validation (only for create, not update)
  if (!isUpdate && !normalized.name && !normalized.type && !normalized.query) {
    throw new Error("Monitor config requires at least 'name', 'type', and 'query' fields")
  }

  // Handle options object snake_case conversions
  if (normalized.options && typeof normalized.options === 'object') {
    const opts = { ...(normalized.options as Record<string, unknown>) }

    // Common snake_case -> camelCase conversions. Keep this in sync with
    // `MonitorOptionsSchema` so every documented camelCase key has its
    // snake_case alias mapped — missing entries surface as spurious
    // "unknown option key" warnings for callers using snake_case.
    const optionMappings: [string, string][] = [
      ['notify_no_data', 'notifyNoData'],
      ['no_data_timeframe', 'noDataTimeframe'],
      ['new_host_delay', 'newHostDelay'],
      ['new_group_delay', 'newGroupDelay'],
      ['evaluation_delay', 'evaluationDelay'],
      ['renotify_interval', 'renotifyInterval'],
      ['renotify_occurrences', 'renotifyOccurrences'],
      ['renotify_statuses', 'renotifyStatuses'],
      ['timeout_h', 'timeoutH'],
      ['notify_audit', 'notifyAudit'],
      ['include_tags', 'includeTags'],
      ['require_full_window', 'requireFullWindow'],
      ['escalation_message', 'escalationMessage'],
      ['notification_preset_name', 'notificationPresetName'],
      ['on_missing_data', 'onMissingData'],
      ['group_retention_duration', 'groupRetentionDuration'],
      ['threshold_windows', 'thresholdWindows'],
      ['scheduling_options', 'schedulingOptions'],
      ['locked', 'locked'],
      ['silenced', 'silenced']
    ]

    for (const [snake, camel] of optionMappings) {
      if (snake in opts && !(camel in opts)) {
        opts[camel] = opts[snake]
        delete opts[snake]
      }
    }

    // Handle nested thresholds
    if (opts.thresholds && typeof opts.thresholds === 'object') {
      const thresholds = { ...(opts.thresholds as Record<string, unknown>) }
      const thresholdMappings: [string, string][] = [
        ['critical', 'critical'],
        ['warning', 'warning'],
        ['ok', 'ok'],
        ['critical_recovery', 'criticalRecovery'],
        ['warning_recovery', 'warningRecovery']
      ]
      for (const [snake, camel] of thresholdMappings) {
        if (snake in thresholds && !(camel in thresholds) && snake !== camel) {
          thresholds[camel] = thresholds[snake]
          delete thresholds[snake]
        }
      }
      opts.thresholds = thresholds
    }

    normalized.options = opts
  }

  return normalized
}

export async function createMonitor(
  api: v1.MonitorsApi,
  config: Record<string, unknown>,
  site: string = 'datadoghq.com'
) {
  const normalized = normalizeMonitorConfig(config)

  // Validate the normalized (camelCase) config against the typed schema before
  // any HTTP call (design.md "Sequence / control flow" steps 4–7). Wrong-type
  // values surface as `EINVALID_MONITOR_CONFIG:` errors; `.passthrough()`
  // preserves unknown keys so they still reach Datadog.
  try {
    MonitorConfigSchema.parse(normalized)
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`EINVALID_MONITOR_CONFIG: ${summarizeZodIssue(error)}`)
    }
    throw error
  }

  const warnings = collectUnknownKeyWarnings(normalized)

  const body = normalized as unknown as v1.Monitor
  const monitor = await api.createMonitor({ body })
  const result: { success: true; monitor: MonitorDetail; warnings?: string[] } = {
    success: true,
    monitor: formatMonitorDetail(monitor, site)
  }
  if (warnings.length > 0) {
    result.warnings = warnings
  }
  return result
}

/**
 * Validate a monitor body without creating it (dry-run).
 * Calls POST /api/v1/monitor/validate. The Datadog SDK exposes this as
 * `v1.MonitorsApi.validateMonitor({ body })`. A 400 response surfaces verbatim
 * via `handleDatadogError`, matching the error shape a failed create would yield.
 *
 * Read-only safety: this endpoint is non-mutating, so the dispatcher allows
 * `action: 'create'` with `dry_run: true` even when `--read-only` is set.
 */
export async function dryRunMonitor(
  api: v1.MonitorsApi,
  config: Record<string, unknown>
): Promise<{ valid: true; dryRun: true; monitor: Record<string, unknown> }> {
  const normalized = normalizeMonitorConfig(config)
  const body = normalized as unknown as v1.Monitor
  await api.validateMonitor({ body })
  return {
    valid: true,
    dryRun: true,
    monitor: normalized
  }
}

export async function updateMonitor(
  api: v1.MonitorsApi,
  id: string,
  config: Record<string, unknown>,
  site: string = 'datadoghq.com'
) {
  const monitorId = Number.parseInt(id, 10)
  const normalized = normalizeMonitorConfig(config, true)

  // Validate the normalized (camelCase) config against the typed schema before
  // any HTTP call (design.md "Sequence / control flow" steps 4–7). Partial
  // configs are accepted because every key on `MonitorConfigSchema` is
  // `.optional()`; only the supplied keys are forwarded to Datadog. Wrong-type
  // values surface as `EINVALID_MONITOR_CONFIG:` errors; `.passthrough()`
  // preserves unknown keys so they still reach Datadog.
  try {
    MonitorConfigSchema.parse(normalized)
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`EINVALID_MONITOR_CONFIG: ${summarizeZodIssue(error)}`)
    }
    throw error
  }

  const warnings = collectUnknownKeyWarnings(normalized)

  const body = normalized as unknown as v1.MonitorUpdateRequest
  const monitor = await api.updateMonitor({ monitorId, body })
  const result: { success: true; monitor: MonitorDetail; warnings?: string[] } = {
    success: true,
    monitor: formatMonitorDetail(monitor, site)
  }
  if (warnings.length > 0) {
    result.warnings = warnings
  }
  return result
}

export async function deleteMonitor(api: v1.MonitorsApi, id: string) {
  const monitorId = Number.parseInt(id, 10)
  await api.deleteMonitor({ monitorId })
  return { success: true, message: `Monitor ${id} deleted` }
}

export async function muteMonitor(api: v1.MonitorsApi, id: string, params: { end?: number }) {
  const monitorId = Number.parseInt(id, 10)
  // Use validate endpoint with mute options
  const monitor = await api.getMonitor({ monitorId })

  // Update the monitor with mute options
  await api.updateMonitor({
    monitorId,
    body: {
      options: {
        ...monitor.options,
        silenced: { '*': params.end ?? null }
      }
    } as unknown as v1.MonitorUpdateRequest
  })
  return { success: true, message: `Monitor ${id} muted` }
}

export async function unmuteMonitor(api: v1.MonitorsApi, id: string) {
  const monitorId = Number.parseInt(id, 10)
  const monitor = await api.getMonitor({ monitorId })

  // Update the monitor to remove silenced option
  await api.updateMonitor({
    monitorId,
    body: {
      options: {
        ...monitor.options,
        silenced: {}
      }
    } as unknown as v1.MonitorUpdateRequest
  })
  return { success: true, message: `Monitor ${id} unmuted` }
}

/**
 * Top N monitors with real names and context breakdown
 * Fetches alert events, groups by monitor_id, and enriches with real monitor names from monitors API
 */
export async function topMonitors(
  eventsApi: v2.EventsApi,
  monitorsApi: v1.MonitorsApi,
  params: {
    from?: string
    to?: string
    tags?: string[]
    limit?: number
    contextTags?: string[]
    maxEvents?: number
  },
  limits: LimitsConfig,
  site: string
) {
  // Time range setup
  const defaultFrom = hoursAgo(limits.defaultTimeRangeHours)
  const defaultTo = now()
  const [validFrom, validTo] = ensureValidTimeRange(
    parseTime(params.from, defaultFrom),
    parseTime(params.to, defaultTo)
  )
  const fromTime = new Date(validFrom * 1000).toISOString()
  const toTime = new Date(validTo * 1000).toISOString()

  // Build query for alert events
  const queryParts: string[] = ['source:alert']
  if (params.tags) {
    queryParts.push(...params.tags)
  }
  const query = queryParts.join(' ')

  // Step 1: Fetch alert events
  const searchResponse = await eventsApi.searchEvents({
    body: {
      filter: {
        query,
        from: fromTime,
        to: toTime
      },
      page: {
        limit: Math.min(params.maxEvents ?? 5000, 5000)
      },
      sort: 'timestamp'
    }
  })

  const rawEvents = searchResponse.data ?? []

  // Format events to extract monitor_id and parse structure
  const events = rawEvents.map(formatEventV2)

  // Step 2: Group by monitor_id + extract context
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

  const monitorGroups = new Map<
    number,
    {
      monitorId: number
      eventCount: number
      contextBreakdown: Map<string, number>
    }
  >()

  for (const event of events) {
    const monitorId = event.monitorId
    if (typeof monitorId !== 'number') continue

    let group = monitorGroups.get(monitorId)
    if (!group) {
      group = {
        monitorId,
        eventCount: 0,
        contextBreakdown: new Map()
      }
      monitorGroups.set(monitorId, group)
    }
    group.eventCount++

    // Extract context tag
    const tags = event.tags
    for (const prefix of contextPrefixes) {
      const tag = tags.find((t) => t.startsWith(`${prefix}:`))
      if (tag) {
        group.contextBreakdown.set(tag, (group.contextBreakdown.get(tag) || 0) + 1)
        break // Only count first matching context tag
      }
    }
  }

  // Step 3: Fetch real monitor names for unique monitor_ids (in parallel)
  const monitorIds = Array.from(monitorGroups.keys())
  const monitorNames = new Map<number, { name: string; message: string }>()

  // Parallelize monitor fetches with Promise.allSettled to reduce latency
  const monitorPromises = monitorIds.map(async (monitorId) => {
    try {
      const monitor = await monitorsApi.getMonitor({ monitorId })
      return {
        monitorId,
        name: monitor.name ?? `Monitor ${monitorId}`,
        message: monitor.message ?? ''
      }
    } catch {
      // Fallback if monitor fetch fails (e.g., deleted monitor)
      return {
        monitorId,
        name: `Monitor ${monitorId}`,
        message: ''
      }
    }
  })

  const results = await Promise.allSettled(monitorPromises)
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { monitorId, name, message } = result.value
      monitorNames.set(monitorId, { name, message })
    }
  }

  // Step 4: Build result with real monitor names
  const topMonitors = Array.from(monitorGroups.values())
    .map((group) => {
      const monitorInfo = monitorNames.get(group.monitorId) ?? {
        name: `Monitor ${group.monitorId}`,
        message: ''
      }

      const contextBreakdown = Array.from(group.contextBreakdown.entries())
        .map(([context, count]) => ({ context, count }))
        .sort((a, b) => b.count - a.count)

      // Include monitors with no context tags as "no_context"
      const byContext =
        contextBreakdown.length > 0
          ? contextBreakdown
          : [{ context: 'no_context', count: group.eventCount }]

      return {
        monitor_id: group.monitorId,
        name: monitorInfo.name,
        message: monitorInfo.message,
        total_count: group.eventCount,
        by_context: byContext
      }
    })
    .sort((a, b) => b.total_count - a.total_count)
    .slice(0, params.limit ?? 10)
    .map((m, i) => ({ rank: i + 1, ...m }))

  return {
    top: topMonitors,
    meta: {
      query,
      from: fromTime,
      to: toTime,
      totalMonitors: monitorGroups.size,
      totalEvents: events.length,
      contextPrefixes: Array.from(contextPrefixes),
      datadog_url: buildEventsUrl(query, validFrom, validTo, site)
    }
  }
}

export function registerMonitorsTool(
  server: McpServer,
  api: v1.MonitorsApi,
  eventsApi: v2.EventsApi,
  limits: LimitsConfig,
  readOnly: boolean = false,
  site: string = 'datadoghq.com'
): void {
  server.tool(
    'monitors',
    `Manage Datadog monitors. Actions: list, get, search, create, update, delete, mute, unmute, top, history.
Filters: name, tags, groupStates (alert/warn/ok/no data).
get/create/update return the full options object so callers can safely read-then-patch.

create/update accept a config object validated against a typed schema covering the documented Datadog Monitor fields:
  - Top-level: name, type, query, message, tags, priority (1-5, nullable), restrictedRoles, multi, options.
  - options.* validated keys grouped by category:
    - notification:    notifyNoData, noDataTimeframe, notifyAudit, notificationPresetName.
    - evaluation/delay: newHostDelay, newGroupDelay, evaluationDelay, requireFullWindow, onMissingData.
    - renotification:  renotifyInterval (nullable), renotifyOccurrences, renotifyStatuses, escalationMessage.
    - lifecycle:       timeoutH (nullable), includeTags, locked, silenced (record of timestamps/null), groupRetentionDuration.
    - thresholds:      thresholds (critical/warning/ok/criticalRecovery/warningRecovery/unknown), thresholdWindows.
    - scheduling:      schedulingOptions.
Unknown keys (top-level or under options) are forwarded to Datadog as-is and surfaced via an optional warnings array on the response, so the schema does not lag the API.
snake_case aliases are accepted on input and normalized to camelCase before validation.
Validation errors short-circuit before any HTTP call and surface as 'EINVALID_MONITOR_CONFIG: <path>: <expected>'.
Reference: https://docs.datadoghq.com/api/latest/monitors/

top: Ranked monitors by alert frequency with real monitor names and context breakdown.
  - Returns: {rank, monitor_id, name (with {{template.vars}}), message (template), total_count, by_context}
  - Perfect for weekly/daily alert reports
  - Gets real monitor names from monitors API (not event titles)
  - WARNING: total_count is the raw alert-event count and INCLUDES renotifies/re-evaluations.
    For monitors stuck in Alert state, Datadog emits a renotify event every renotify_interval
    minutes, which inflates this count well beyond the number of real fires. When the question
    is "how many times did this monitor actually fire", use action=history instead.

history: Count and list real state transitions for one monitor over a time window.
  - Inputs: id (required, monitor ID), from/to (optional time range), transitionType (optional
    filter, defaults to ["alert","alert recovery"]), group (optional multi-alert group filter).
  - Returns: {transitions: [{timestamp, monitorId, monitorName, group, fromState, toState,
    transitionType, eventId}], count, meta}
  - count = transitions.length — the number of REAL state changes (fires + recoveries by
    default), NOT the renotify-inflated count returned by action=top or events action=search.
  - Backed by Datadog v2 events search with a hardcoded source:alert + @monitor.transition.
    transition_type filter that excludes renotifies by default. To include renotifies, pass
    transitionType including "renotify".

For generic event grouping (deployments, configs), use events tool instead. Note that the
events tool's action=search with source:alert ALSO includes renotifies; use its
transitionType filter (or this action=history) for fires-only counts.`,
    InputSchema,
    async ({
      action,
      id,
      query,
      name,
      tags,
      groupStates,
      limit,
      config,
      end,
      from,
      to,
      contextTags,
      maxEvents,
      transitionType,
      group,
      dry_run: dryRun
    }) => {
      try {
        // Dry-run create is a non-mutating validation call against POST
        // /api/v1/monitor/validate. Skip the write-action read-only gate when
        // (action === 'create' && dryRun === true); for any other branch the
        // standard gate applies, so plain `create` (or omitted dry_run) is
        // still blocked under --read-only.
        const isDryRunCreate = action === 'create' && dryRun === true
        if (!isDryRunCreate) {
          checkReadOnly(action, readOnly)
        }
        switch (action) {
          case 'list':
            return toolResult(
              await listMonitors(api, { name, tags, groupStates, limit }, limits, site)
            )

          case 'get': {
            const monitorId = requireParam(id, 'id', 'get')
            return toolResult(await getMonitor(api, monitorId, site))
          }

          case 'search': {
            const searchQuery = requireParam(query, 'query', 'search')
            return toolResult(await searchMonitors(api, searchQuery, limits, site))
          }

          case 'create': {
            const monitorConfig = requireParam(config, 'config', 'create')
            if (dryRun) {
              return toolResult(await dryRunMonitor(api, monitorConfig))
            }
            return toolResult(await createMonitor(api, monitorConfig, site))
          }

          case 'update': {
            const monitorId = requireParam(id, 'id', 'update')
            const updateConfig = requireParam(config, 'config', 'update')
            return toolResult(await updateMonitor(api, monitorId, updateConfig, site))
          }

          case 'delete': {
            const monitorId = requireParam(id, 'id', 'delete')
            return toolResult(await deleteMonitor(api, monitorId))
          }

          case 'mute': {
            const monitorId = requireParam(id, 'id', 'mute')
            return toolResult(await muteMonitor(api, monitorId, { end }))
          }

          case 'unmute': {
            const monitorId = requireParam(id, 'id', 'unmute')
            return toolResult(await unmuteMonitor(api, monitorId))
          }

          case 'top':
            return toolResult(
              await topMonitors(
                eventsApi,
                api,
                {
                  from,
                  to,
                  tags,
                  limit,
                  contextTags,
                  maxEvents
                },
                limits,
                site
              )
            )

          case 'history': {
            const monitorIdString = requireParam(id, 'id', 'history')
            const monitorId = Number.parseInt(monitorIdString, 10)
            if (Number.isNaN(monitorId)) {
              throw new Error(`Invalid monitor ID: ${monitorIdString}`)
            }
            return toolResult(
              await historyMonitor(
                eventsApi,
                monitorId,
                { from, to, transitionType, group },
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
