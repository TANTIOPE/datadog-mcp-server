import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v2 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam, checkReadOnly } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['list', 'get', 'search', 'create', 'update', 'delete'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z.string().optional().describe('Incident ID (required for get/update/delete)'),
  query: z.string().optional().describe('Search query (for search action)'),
  status: z
    .enum(['active', 'stable', 'resolved'])
    .optional()
    .describe('Filter by status (for list)'),
  limit: z.number().optional().describe('Maximum number of incidents to return (default: 50)'),
  config: z
    .record(z.unknown())
    .optional()
    .describe(
      'Incident configuration (for create/update). Create requires: title. Update can modify: title, status, severity, fields.'
    )
}

interface IncidentSummary {
  id: string
  title: string
  status: string
  severity: string | null
  state: string | null
  customerImpactScope: string | null
  customerImpacted: boolean
  commander: {
    name: string | null
    email: string | null
    handle: string | null
  }
  createdAt: string
  modifiedAt: string
  resolvedAt: string | null
  timeToDetect: number | null
  timeToRepair: number | null
}

export function formatIncident(i: v2.IncidentResponseData): IncidentSummary {
  const attrs = i.attributes
  const commander = i.relationships?.commanderUser?.data
  return {
    id: i.id ?? '',
    title: attrs?.title ?? '',
    status: String(attrs?.state ?? 'unknown'),
    severity: attrs?.severity ? String(attrs.severity) : null,
    state: attrs?.state ? String(attrs.state) : null,
    customerImpactScope: attrs?.customerImpactScope ?? null,
    customerImpacted: attrs?.customerImpacted ?? false,
    commander: {
      name: null, // Would need to resolve from relationships
      email: null,
      handle: commander?.id ?? null
    },
    createdAt: attrs?.created ? new Date(attrs.created).toISOString() : '',
    modifiedAt: attrs?.modified ? new Date(attrs.modified).toISOString() : '',
    resolvedAt: attrs?.resolved ? new Date(attrs.resolved).toISOString() : null,
    timeToDetect: attrs?.timeToDetect ?? null,
    timeToRepair: attrs?.timeToRepair ?? null
  }
}

export async function listIncidents(
  api: v2.IncidentsApi,
  params: { status?: 'active' | 'stable' | 'resolved'; limit?: number },
  limits: LimitsConfig
) {
  const effectiveLimit = params.limit ?? limits.defaultLimit

  // Note: listIncidents is an unstable operation that requires enablement
  const response = await api.listIncidents({
    pageSize: effectiveLimit
  })

  let incidents = (response.data ?? []).map(formatIncident)

  // Filter by status client-side if specified
  if (params.status) {
    incidents = incidents.filter((i) => i.state?.toLowerCase() === params.status)
  }

  // Apply limit after filtering (in case status filter reduced count)
  incidents = incidents.slice(0, effectiveLimit)

  return {
    incidents,
    total: incidents.length
  }
}

export async function getIncident(api: v2.IncidentsApi, id: string) {
  const response = await api.getIncident({ incidentId: id })
  return {
    incident: response.data ? formatIncident(response.data) : null
  }
}

export async function searchIncidents(api: v2.IncidentsApi, query: string, limits: LimitsConfig) {
  const response = await api.searchIncidents({
    query,
    pageSize: limits.defaultLimit
  })

  const incidents = (response.data?.attributes?.incidents ?? []).map(
    (i: v2.IncidentSearchResponseIncidentsData) => ({
      id: i.data?.id ?? '',
      title: i.data?.attributes?.title ?? '',
      state: i.data?.attributes?.state ?? 'unknown'
    })
  )

  return {
    incidents,
    total: response.data?.attributes?.total ?? incidents.length
  }
}

export async function createIncident(api: v2.IncidentsApi, config: Record<string, unknown>) {
  const body = {
    data: {
      type: 'incidents' as const,
      attributes: config
    }
  } as unknown as v2.IncidentCreateRequest

  const response = await api.createIncident({ body })
  return {
    success: true,
    incident: response.data ? formatIncident(response.data) : null
  }
}

export async function updateIncident(
  api: v2.IncidentsApi,
  id: string,
  config: Record<string, unknown>
) {
  const body = {
    data: {
      type: 'incidents' as const,
      id,
      attributes: config
    }
  } as unknown as v2.IncidentUpdateRequest

  const response = await api.updateIncident({ incidentId: id, body })
  return {
    success: true,
    incident: response.data ? formatIncident(response.data) : null
  }
}

export async function deleteIncident(api: v2.IncidentsApi, id: string) {
  await api.deleteIncident({ incidentId: id })
  return {
    success: true,
    message: `Incident ${id} deleted`
  }
}

export function registerIncidentsTool(
  server: McpServer,
  api: v2.IncidentsApi,
  limits: LimitsConfig,
  readOnly: boolean = false,
  _site: string = 'datadoghq.com'
): void {
  server.tool(
    'incidents',
    'Manage Datadog incidents for incident response. Actions: list, get, search, create, update, delete. Use for: incident management, on-call response, postmortems, tracking MTTR/MTTD.',
    InputSchema,
    async ({ action, id, query, status, limit, config }) => {
      try {
        checkReadOnly(action, readOnly)
        switch (action) {
          case 'list':
            return toolResult(await listIncidents(api, { status, limit }, limits))

          case 'get': {
            const incidentId = requireParam(id, 'id', 'get')
            return toolResult(await getIncident(api, incidentId))
          }

          case 'search': {
            const searchQuery = requireParam(query, 'query', 'search')
            return toolResult(await searchIncidents(api, searchQuery, limits))
          }

          case 'create': {
            const incidentConfig = requireParam(config, 'config', 'create')
            return toolResult(await createIncident(api, incidentConfig))
          }

          case 'update': {
            const incidentId = requireParam(id, 'id', 'update')
            const incidentConfig = requireParam(config, 'config', 'update')
            return toolResult(await updateIncident(api, incidentId, incidentConfig))
          }

          case 'delete': {
            const incidentId = requireParam(id, 'id', 'delete')
            return toolResult(await deleteIncident(api, incidentId))
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
