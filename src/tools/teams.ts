import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { v2 } from '@datadog/datadog-api-client'
import { handleDatadogError, requireParam } from '../errors/datadog.js'
import { toolResult } from '../utils/format.js'
import type { LimitsConfig } from '../config/schema.js'

const ActionSchema = z.enum(['list', 'get', 'members'])

const InputSchema = {
  action: ActionSchema.describe('Action to perform'),
  id: z.string().optional().describe('Team ID (required for get/members actions)'),
  filter: z.string().optional().describe('Filter teams by name'),
  pageSize: z.number().optional().describe('Number of teams to return per page'),
  pageNumber: z.number().optional().describe('Page number for pagination')
}

interface TeamSummary {
  id: string
  name: string
  handle: string
  description: string | null
  summary: string | null
  linkCount: number
  userCount: number
  createdAt: string
  modifiedAt: string
}

interface TeamMemberSummary {
  id: string
  type: string
  attributes: {
    role: string
  }
  relationships: {
    userId: string | null
  }
}

export function formatTeam(team: v2.Team): TeamSummary {
  const attrs = team.attributes ?? {}

  return {
    id: team.id ?? '',
    name: attrs.name ?? '',
    handle: attrs.handle ?? '',
    description: attrs.description ?? null,
    summary: attrs.summary ?? null,
    linkCount: attrs.linkCount ?? 0,
    userCount: attrs.userCount ?? 0,
    createdAt: attrs.createdAt?.toISOString() ?? '',
    modifiedAt: attrs.modifiedAt?.toISOString() ?? ''
  }
}

export function formatTeamMember(member: v2.UserTeam): TeamMemberSummary {
  const attrs = member.attributes ?? {}
  const relationships = member.relationships ?? {}

  return {
    id: member.id ?? '',
    type: String(member.type ?? ''),
    attributes: {
      role: String(attrs.role ?? '')
    },
    relationships: {
      userId: relationships.user?.data?.id ?? null
    }
  }
}

export async function listTeams(
  api: v2.TeamsApi,
  params: {
    filter?: string
    pageSize?: number
    pageNumber?: number
  },
  limits: LimitsConfig
) {
  const response = await api.listTeams({
    filterKeyword: params.filter,
    pageSize: Math.min(params.pageSize ?? limits.maxResults, limits.maxResults),
    pageNumber: params.pageNumber ?? 0
  })

  const teams = (response.data ?? []).map(formatTeam)

  return {
    teams,
    meta: {
      totalCount: teams.length
    }
  }
}

export async function getTeam(api: v2.TeamsApi, teamId: string) {
  const response = await api.getTeam({ teamId })

  if (!response.data) {
    throw new Error(`Team ${teamId} not found`)
  }

  return {
    team: formatTeam(response.data)
  }
}

export async function getTeamMembers(api: v2.TeamsApi, teamId: string, limits: LimitsConfig) {
  const response = await api.getTeamMemberships({
    teamId,
    pageSize: limits.maxResults
  })

  const members = (response.data ?? []).map(formatTeamMember)

  return {
    members,
    meta: {
      totalCount: members.length
    }
  }
}

export function registerTeamsTool(server: McpServer, api: v2.TeamsApi, limits: LimitsConfig): void {
  server.tool(
    'teams',
    'Manage Datadog teams. Actions: list (with filters), get (by ID), members (list team members). Use for: team organization, access management, collaboration.',
    InputSchema,
    async ({ action, id, filter, pageSize, pageNumber }) => {
      try {
        switch (action) {
          case 'list':
            return toolResult(await listTeams(api, { filter, pageSize, pageNumber }, limits))

          case 'get': {
            const teamId = requireParam(id, 'id', 'get')
            return toolResult(await getTeam(api, teamId))
          }

          case 'members': {
            const teamId = requireParam(id, 'id', 'members')
            return toolResult(await getTeamMembers(api, teamId, limits))
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
