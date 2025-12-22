/**
 * Datadog URL builders for deep linking to the Datadog UI
 *
 * These functions generate URLs that link directly to Datadog's web interface,
 * allowing AI tools to provide evidence links back to the source data.
 */

/**
 * Map Datadog API sites to their corresponding app URLs
 */
const SITE_TO_APP_URL: Record<string, string> = {
  'datadoghq.com': 'https://app.datadoghq.com',
  'us3.datadoghq.com': 'https://us3.datadoghq.com',
  'us5.datadoghq.com': 'https://us5.datadoghq.com',
  'datadoghq.eu': 'https://app.datadoghq.eu',
  'ap1.datadoghq.com': 'https://ap1.datadoghq.com',
  'ddog-gov.com': 'https://app.ddog-gov.com'
}

/**
 * Get the app base URL for a given Datadog site
 */
function getAppBaseUrl(site: string = 'datadoghq.com'): string {
  return SITE_TO_APP_URL[site] ?? SITE_TO_APP_URL['datadoghq.com']!
}

/**
 * Convert Unix seconds to milliseconds for URL params
 */
function toMs(seconds: number): number {
  return seconds * 1000
}

/**
 * Build a Datadog Logs Explorer URL
 *
 * @param query - Log search query
 * @param fromSec - Start time (Unix seconds)
 * @param toSec - End time (Unix seconds)
 * @param site - Datadog site (default: datadoghq.com)
 */
export function buildLogsUrl(
  query: string,
  fromSec: number,
  toSec: number,
  site: string = 'datadoghq.com'
): string {
  const base = getAppBaseUrl(site)
  const params = new URLSearchParams({
    query,
    from_ts: toMs(fromSec).toString(),
    to_ts: toMs(toSec).toString()
  })
  return `${base}/logs?${params.toString()}`
}

/**
 * Extract metric name from a PromQL-style query
 * e.g., "avg:system.cpu.user{host:foo}" -> "system.cpu.user"
 */
function extractMetricName(query: string): string {
  // Pattern: aggregation:metric_name{tags} or just metric_name{tags}
  const match = query.match(/^(?:\w+:)?([a-zA-Z0-9_.]+)/)
  return match?.[1] ?? query
}

/**
 * Build a Datadog Metrics Explorer URL
 *
 * @param query - PromQL-style metric query
 * @param fromSec - Start time (Unix seconds)
 * @param toSec - End time (Unix seconds)
 * @param site - Datadog site (default: datadoghq.com)
 */
export function buildMetricsUrl(
  query: string,
  fromSec: number,
  toSec: number,
  site: string = 'datadoghq.com'
): string {
  const base = getAppBaseUrl(site)
  const metricName = extractMetricName(query)
  const params = new URLSearchParams({
    exp_metric: metricName,
    exp_query: query,
    from_ts: toMs(fromSec).toString(),
    to_ts: toMs(toSec).toString()
  })
  return `${base}/metric/explorer?${params.toString()}`
}

/**
 * Build a Datadog APM Traces URL
 * Note: APM uses start/end instead of from_ts/to_ts
 *
 * @param query - APM trace search query
 * @param fromSec - Start time (Unix seconds)
 * @param toSec - End time (Unix seconds)
 * @param site - Datadog site (default: datadoghq.com)
 */
export function buildTracesUrl(
  query: string,
  fromSec: number,
  toSec: number,
  site: string = 'datadoghq.com'
): string {
  const base = getAppBaseUrl(site)
  const params = new URLSearchParams({
    query,
    start: toMs(fromSec).toString(),
    end: toMs(toSec).toString()
  })
  return `${base}/apm/traces?${params.toString()}`
}

/**
 * Build a Datadog Events Explorer URL
 *
 * @param query - Event search query
 * @param fromSec - Start time (Unix seconds)
 * @param toSec - End time (Unix seconds)
 * @param site - Datadog site (default: datadoghq.com)
 */
export function buildEventsUrl(
  query: string,
  fromSec: number,
  toSec: number,
  site: string = 'datadoghq.com'
): string {
  const base = getAppBaseUrl(site)
  const params = new URLSearchParams({
    query,
    from_ts: toMs(fromSec).toString(),
    to_ts: toMs(toSec).toString()
  })
  return `${base}/event/explorer?${params.toString()}`
}

/**
 * Build a Datadog Monitor URL
 *
 * @param monitorId - Monitor ID
 * @param site - Datadog site (default: datadoghq.com)
 */
export function buildMonitorUrl(
  monitorId: string | number,
  site: string = 'datadoghq.com'
): string {
  const base = getAppBaseUrl(site)
  return `${base}/monitors/${monitorId}`
}

/**
 * Build a Datadog Monitors List URL with optional query filters
 *
 * @param options - Filter options (name, tags, groupStates)
 * @param site - Datadog site (default: datadoghq.com)
 */
export function buildMonitorsListUrl(
  options?: { name?: string; tags?: string[]; groupStates?: string[] },
  site: string = 'datadoghq.com'
): string {
  const base = getAppBaseUrl(site)
  const params = new URLSearchParams()

  if (options?.name) {
    params.set('query', options.name)
  }
  if (options?.tags && options.tags.length > 0) {
    params.set('tags', options.tags.join(','))
  }
  if (options?.groupStates && options.groupStates.length > 0) {
    params.set('group_states', options.groupStates.join(','))
  }

  const queryString = params.toString()
  return queryString ? `${base}/monitors/manage?${queryString}` : `${base}/monitors/manage`
}

/**
 * Build a Datadog RUM Explorer URL
 *
 * @param query - RUM search query
 * @param fromSec - Start time (Unix seconds)
 * @param toSec - End time (Unix seconds)
 * @param site - Datadog site (default: datadoghq.com)
 */
export function buildRumUrl(
  query: string,
  fromSec: number,
  toSec: number,
  site: string = 'datadoghq.com'
): string {
  const base = getAppBaseUrl(site)
  const params = new URLSearchParams({
    query,
    from_ts: toMs(fromSec).toString(),
    to_ts: toMs(toSec).toString()
  })
  return `${base}/rum/explorer?${params.toString()}`
}

/**
 * Build a Datadog RUM Session Replay URL
 *
 * @param applicationId - RUM Application ID
 * @param sessionId - Session ID
 * @param site - Datadog site (default: datadoghq.com)
 */
export function buildRumSessionUrl(
  applicationId: string,
  sessionId: string,
  site: string = 'datadoghq.com'
): string {
  const base = getAppBaseUrl(site)
  return `${base}/rum/replay/sessions/${sessionId}?applicationId=${encodeURIComponent(applicationId)}`
}

/**
 * Build a Datadog Dashboard URL
 *
 * @param dashboardId - Dashboard ID
 * @param site - Datadog site (default: datadoghq.com)
 */
export function buildDashboardUrl(dashboardId: string, site: string = 'datadoghq.com'): string {
  const base = getAppBaseUrl(site)
  return `${base}/dashboard/${dashboardId}`
}

/**
 * Build a Datadog SLO URL
 *
 * @param sloId - SLO ID
 * @param site - Datadog site (default: datadoghq.com)
 */
export function buildSloUrl(sloId: string, site: string = 'datadoghq.com'): string {
  const base = getAppBaseUrl(site)
  return `${base}/slo/${sloId}`
}

/**
 * Build a Datadog Incident URL
 *
 * @param incidentId - Incident ID
 * @param site - Datadog site (default: datadoghq.com)
 */
export function buildIncidentUrl(incidentId: string, site: string = 'datadoghq.com'): string {
  const base = getAppBaseUrl(site)
  return `${base}/incidents/${incidentId}`
}

/**
 * Build a Datadog Synthetic Test URL
 *
 * @param publicId - Synthetic test public ID
 * @param site - Datadog site (default: datadoghq.com)
 */
export function buildSyntheticUrl(publicId: string, site: string = 'datadoghq.com'): string {
  const base = getAppBaseUrl(site)
  return `${base}/synthetics/details/${publicId}`
}

/**
 * Build a Datadog Notebook URL
 *
 * @param notebookId - Notebook ID
 * @param site - Datadog site (default: datadoghq.com)
 */
export function buildNotebookUrl(notebookId: number, site: string = 'datadoghq.com'): string {
  const base = getAppBaseUrl(site)
  return `${base}/notebook/${notebookId}`
}
