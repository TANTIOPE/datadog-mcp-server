import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { DatadogClients } from '../config/datadog.js'
import type { LimitsConfig, FeaturesConfig } from '../config/schema.js'

import { registerMonitorsTool } from './monitors.js'
import { registerDashboardsTool } from './dashboards.js'
import { registerLogsTool } from './logs.js'
import { registerMetricsTool } from './metrics.js'
import { registerTracesTool } from './traces.js'
import { registerEventsTool } from './events.js'
import { registerIncidentsTool } from './incidents.js'
import { registerSlosTool } from './slos.js'
import { registerSyntheticsTool } from './synthetics.js'
import { registerHostsTool } from './hosts.js'
import { registerDowntimesTool } from './downtimes.js'
import { registerRumTool } from './rum.js'
import { registerSecurityTool } from './security.js'
import { registerNotebooksTool } from './notebooks.js'
import { registerUsersTool } from './users.js'
import { registerTeamsTool } from './teams.js'
import { registerTagsTool } from './tags.js'
import { registerUsageTool } from './usage.js'
import { registerAuthTool } from './auth.js'

export function registerAllTools(
  server: McpServer,
  clients: DatadogClients,
  limits: LimitsConfig,
  features: FeaturesConfig,
  site: string = 'datadoghq.com'
): void {
  const { readOnly, disabledTools } = features
  const enabled = (tool: string) => !disabledTools.includes(tool)

  if (enabled('monitors')) registerMonitorsTool(server, clients.monitors, limits, readOnly, site)
  if (enabled('dashboards'))
    registerDashboardsTool(server, clients.dashboards, limits, readOnly, site)
  if (enabled('logs')) registerLogsTool(server, clients.logs, limits, site)
  if (enabled('metrics'))
    registerMetricsTool(server, clients.metricsV1, clients.metricsV2, limits, site)
  if (enabled('traces')) registerTracesTool(server, clients.spans, clients.services, limits, site)
  if (enabled('events'))
    registerEventsTool(
      server,
      clients.eventsV1,
      clients.eventsV2,
      clients.monitors,
      limits,
      readOnly,
      site
    )
  if (enabled('incidents')) registerIncidentsTool(server, clients.incidents, limits, readOnly, site)
  if (enabled('slos')) registerSlosTool(server, clients.slo, limits, readOnly, site)
  if (enabled('synthetics'))
    registerSyntheticsTool(server, clients.synthetics, limits, readOnly, site)
  if (enabled('hosts')) registerHostsTool(server, clients.hosts, limits, readOnly)
  if (enabled('downtimes')) registerDowntimesTool(server, clients.downtimes, limits, readOnly)
  if (enabled('rum')) registerRumTool(server, clients.rum, limits, site)
  if (enabled('security')) registerSecurityTool(server, clients.security, limits)
  if (enabled('notebooks')) registerNotebooksTool(server, clients.notebooks, limits, readOnly, site)
  if (enabled('users')) registerUsersTool(server, clients.users, limits)
  if (enabled('teams')) registerTeamsTool(server, clients.teams, limits)
  if (enabled('tags')) registerTagsTool(server, clients.tags, limits, readOnly)
  if (enabled('usage')) registerUsageTool(server, clients.usage, limits)
  if (enabled('auth')) registerAuthTool(server, clients)
}
