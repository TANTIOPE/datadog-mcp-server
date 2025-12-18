/**
 * Mock helpers for testing MCP tools
 */
import { v1, v2, client } from '@datadog/datadog-api-client'

/**
 * Create a mock Datadog configuration
 */
export function createMockConfig(): client.Configuration {
  const config = client.createConfiguration({
    authMethods: {
      apiKeyAuth: 'test-api-key',
      appKeyAuth: 'test-app-key'
    }
  })

  // Enable unstable operations for v2 APIs (required for incidents)
  config.unstableOperations = {
    'v2.listIncidents': true,
    'v2.getIncident': true,
    'v2.searchIncidents': true,
    'v2.createIncident': true,
    'v2.updateIncident': true,
    'v2.deleteIncident': true
  }

  return config
}

/**
 * Create mock API clients for testing
 */
export function createMockClients(config: client.Configuration) {
  return {
    monitors: new v1.MonitorsApi(config),
    dashboards: new v1.DashboardsApi(config),
    logs: new v2.LogsApi(config),
    metrics: new v1.MetricsApi(config),
    spans: new v2.SpansApi(config),
    services: new v1.ServiceLevelObjectivesApi(config),
    events: new v1.EventsApi(config)
  }
}

/**
 * Default test limits
 */
export const testLimits = {
  maxResults: 100,
  maxLogLines: 500,
  maxTraceSpans: 200,
  defaultTimeRangeHours: 1
}
