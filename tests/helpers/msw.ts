/**
 * MSW (Mock Service Worker) setup for Datadog API mocking
 */
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

// Datadog API base URLs
export const DD_API_V1 = 'https://api.datadoghq.com/api/v1'
export const DD_API_V2 = 'https://api.datadoghq.com/api/v2'

// Default handlers - empty, tests add their own
export const server = setupServer()

/**
 * Helper to create a successful JSON response
 */
export function jsonResponse<T>(data: T, status = 200) {
  return HttpResponse.json(data, { status })
}

/**
 * Helper to create an error response matching Datadog API format
 */
export function errorResponse(code: number, message: string) {
  return HttpResponse.json({ errors: [message] }, { status: code })
}

/**
 * Common Datadog API endpoint patterns
 */
export const endpoints = {
  // Monitors
  listMonitors: `${DD_API_V1}/monitor`,
  getMonitor: (id: number) => `${DD_API_V1}/monitor/${id}`,
  searchMonitors: `${DD_API_V1}/monitor/search`,

  // Dashboards
  listDashboards: `${DD_API_V1}/dashboard`,
  getDashboard: (id: string) => `${DD_API_V1}/dashboard/${id}`,

  // Logs
  listLogs: `${DD_API_V2}/logs/events/search`,
  aggregateLogs: `${DD_API_V2}/logs/analytics/aggregate`,

  // Metrics
  queryMetrics: `${DD_API_V1}/query`,
  listMetrics: `${DD_API_V1}/metrics`,
  searchMetrics: `${DD_API_V1}/search`,
  getMetricMetadata: (name: string) => `${DD_API_V1}/metrics/${name}`,

  // Traces/APM
  listSpans: `${DD_API_V2}/spans/events/search`,
  aggregateSpans: `${DD_API_V2}/spans/analytics/aggregate`,
  listServices: `${DD_API_V1}/service_dependencies`,

  // Events - v1
  listEvents: `${DD_API_V1}/events`,
  getEvent: (id: number) => `${DD_API_V1}/events/${id}`,
  createEvent: `${DD_API_V1}/events`,
  // Events - v2
  searchEvents: `${DD_API_V2}/events/search`,

  // P2 Tools - Hosts
  listHosts: `${DD_API_V1}/hosts`,
  getHostTotals: `${DD_API_V1}/hosts/totals`,
  muteHost: (hostname: string) => `${DD_API_V1}/host/${hostname}/mute`,
  unmuteHost: (hostname: string) => `${DD_API_V1}/host/${hostname}/unmute`,

  // P2 Tools - Downtimes
  listDowntimes: `${DD_API_V2}/downtime`,
  getDowntime: (id: string) => `${DD_API_V2}/downtime/${id}`,
  createDowntime: `${DD_API_V2}/downtime`,
  updateDowntime: (id: string) => `${DD_API_V2}/downtime/${id}`,
  cancelDowntime: (id: string) => `${DD_API_V2}/downtime/${id}`,
  listMonitorDowntimes: (monitorId: number) => `${DD_API_V2}/monitor/${monitorId}/downtime_matches`,

  // P2 Tools - SLOs
  listSlos: `${DD_API_V1}/slo`,
  searchSlos: `${DD_API_V1}/slo/search`,
  getSlo: (id: string) => `${DD_API_V1}/slo/${id}`,
  createSlo: `${DD_API_V1}/slo`,
  updateSlo: (id: string) => `${DD_API_V1}/slo/${id}`,
  deleteSlo: (id: string) => `${DD_API_V1}/slo/${id}`,
  getSloHistory: (id: string) => `${DD_API_V1}/slo/${id}/history`,

  // P2 Tools - Incidents
  listIncidents: `${DD_API_V2}/incidents`,
  getIncident: (id: string) => `${DD_API_V2}/incidents/${id}`,
  searchIncidents: `${DD_API_V2}/incidents/search`,
  createIncident: `${DD_API_V2}/incidents`,
  updateIncident: (id: string) => `${DD_API_V2}/incidents/${id}`,
  deleteIncident: (id: string) => `${DD_API_V2}/incidents/${id}`,

  // P2 Tools - Synthetics
  listSyntheticsTests: `${DD_API_V1}/synthetics/tests`,
  getApiTest: (publicId: string) => `${DD_API_V1}/synthetics/tests/api/${publicId}`,
  getBrowserTest: (publicId: string) => `${DD_API_V1}/synthetics/tests/browser/${publicId}`,
  createApiTest: `${DD_API_V1}/synthetics/tests/api`,
  createBrowserTest: `${DD_API_V1}/synthetics/tests/browser`,
  updateApiTest: (publicId: string) => `${DD_API_V1}/synthetics/tests/api/${publicId}`,
  updateBrowserTest: (publicId: string) => `${DD_API_V1}/synthetics/tests/browser/${publicId}`,
  deleteSyntheticsTests: `${DD_API_V1}/synthetics/tests/delete`,
  triggerSyntheticsTests: `${DD_API_V1}/synthetics/tests/trigger`,
  getApiTestResults: (publicId: string) => `${DD_API_V1}/synthetics/tests/${publicId}/results`,
  getBrowserTestResults: (publicId: string) =>
    `${DD_API_V1}/synthetics/tests/browser/${publicId}/results`,

  // P3 Tools - Users
  listUsers: `${DD_API_V2}/users`,
  getUser: (id: string) => `${DD_API_V2}/users/${id}`,

  // P3 Tools - Teams (note: API uses singular "team" not "teams")
  listTeams: `${DD_API_V2}/team`,
  getTeam: (id: string) => `${DD_API_V2}/team/${id}`,
  getTeamMembers: (id: string) => `${DD_API_V2}/team/${id}/memberships`,

  // P3 Tools - RUM
  listRumApplications: `${DD_API_V2}/rum/applications`,
  listRumEvents: `${DD_API_V2}/rum/events/search`,
  getRumEvents: `${DD_API_V2}/rum/events`, // GET endpoint for listRUMEvents
  aggregateRumEvents: `${DD_API_V2}/rum/analytics/aggregate`,

  // P3 Tools - Security
  listSecurityRules: `${DD_API_V2}/security_monitoring/rules`,
  getSecurityRule: (id: string) => `${DD_API_V2}/security_monitoring/rules/${id}`,
  searchSecuritySignals: `${DD_API_V2}/security_monitoring/signals/search`,

  // P3 Tools - Notebooks
  listNotebooks: `${DD_API_V1}/notebooks`,
  getNotebook: (id: number) => `${DD_API_V1}/notebooks/${id}`,
  createNotebook: `${DD_API_V1}/notebooks`,
  updateNotebook: (id: number) => `${DD_API_V1}/notebooks/${id}`,
  deleteNotebook: (id: number) => `${DD_API_V1}/notebooks/${id}`,

  // P4 Tools - Tags
  listHostTags: `${DD_API_V1}/tags/hosts`,
  getHostTags: (hostname: string) => `${DD_API_V1}/tags/hosts/${hostname}`,
  createHostTags: (hostname: string) => `${DD_API_V1}/tags/hosts/${hostname}`,
  updateHostTags: (hostname: string) => `${DD_API_V1}/tags/hosts/${hostname}`,
  deleteHostTags: (hostname: string) => `${DD_API_V1}/tags/hosts/${hostname}`,

  // P4 Tools - Usage
  getUsageSummary: `${DD_API_V1}/usage/summary`,
  getUsageHosts: `${DD_API_V1}/usage/hosts`,
  getUsageLogs: `${DD_API_V1}/usage/logs`,
  getUsageTimeseries: `${DD_API_V1}/usage/timeseries`,
  getUsageIndexedSpans: `${DD_API_V1}/usage/indexed-spans`,
  getIngestedSpans: `${DD_API_V1}/usage/ingested-spans`,

  // Utility Tools - Authentication
  validateApiKey: `${DD_API_V1}/validate`
}

/**
 * Create handlers for common error scenarios
 */
export function createErrorHandlers(endpoint: string) {
  return {
    unauthorized: http.all(endpoint, () => errorResponse(401, 'Invalid API key')),
    forbidden: http.all(endpoint, () => errorResponse(403, 'Forbidden')),
    notFound: http.all(endpoint, () => errorResponse(404, 'Not found')),
    rateLimited: http.all(endpoint, () => errorResponse(429, 'Rate limit exceeded')),
    serverError: http.all(endpoint, () => errorResponse(500, 'Internal server error'))
  }
}

export { http, HttpResponse }
