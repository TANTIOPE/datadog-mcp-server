import { client, v1, v2 } from '@datadog/datadog-api-client'
import type { DatadogConfig } from './schema.js'

export interface DatadogClients {
  monitors: v1.MonitorsApi
  dashboards: v1.DashboardsApi
  dashboardLists: v1.DashboardListsApi
  logs: v2.LogsApi
  metricsV1: v1.MetricsApi
  metricsV2: v2.MetricsApi
  eventsV1: v1.EventsApi
  eventsV2: v2.EventsApi
  incidents: v2.IncidentsApi
  downtimes: v2.DowntimesApi
  hosts: v1.HostsApi
  slo: v1.ServiceLevelObjectivesApi
  synthetics: v1.SyntheticsApi
  rum: v2.RUMApi
  security: v2.SecurityMonitoringApi
  notebooks: v1.NotebooksApi
  users: v2.UsersApi
  teams: v2.TeamsApi
  tags: v1.TagsApi
  usage: v1.UsageMeteringApi
  spans: v2.SpansApi
  services: v2.ServiceDefinitionApi
  auth: v1.AuthenticationApi
}

export function createDatadogClients(config: DatadogConfig): DatadogClients {
  const configuration = client.createConfiguration({
    authMethods: {
      apiKeyAuth: config.apiKey,
      appKeyAuth: config.appKey
    }
  })

  if (config.site && config.site !== 'datadoghq.com') {
    configuration.setServerVariables({ site: config.site })
  }

  // Enable unstable operations for v2 APIs
  configuration.unstableOperations = {
    'v2.listIncidents': true,
    'v2.getIncident': true,
    'v2.searchIncidents': true,
    'v2.createIncident': true,
    'v2.updateIncident': true,
    'v2.deleteIncident': true
  }

  return {
    monitors: new v1.MonitorsApi(configuration),
    dashboards: new v1.DashboardsApi(configuration),
    dashboardLists: new v1.DashboardListsApi(configuration),
    logs: new v2.LogsApi(configuration),
    metricsV1: new v1.MetricsApi(configuration),
    metricsV2: new v2.MetricsApi(configuration),
    eventsV1: new v1.EventsApi(configuration),
    eventsV2: new v2.EventsApi(configuration),
    incidents: new v2.IncidentsApi(configuration),
    downtimes: new v2.DowntimesApi(configuration),
    hosts: new v1.HostsApi(configuration),
    slo: new v1.ServiceLevelObjectivesApi(configuration),
    synthetics: new v1.SyntheticsApi(configuration),
    rum: new v2.RUMApi(configuration),
    security: new v2.SecurityMonitoringApi(configuration),
    notebooks: new v1.NotebooksApi(configuration),
    users: new v2.UsersApi(configuration),
    teams: new v2.TeamsApi(configuration),
    tags: new v1.TagsApi(configuration),
    usage: new v1.UsageMeteringApi(configuration),
    spans: new v2.SpansApi(configuration),
    services: new v2.ServiceDefinitionApi(configuration),
    auth: new v1.AuthenticationApi(configuration)
  }
}
